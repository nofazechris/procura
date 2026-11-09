import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migratedPglite } from "../helpers/pg";

/** The business_wallets guarantees, attacked as the non-owner app role exactly like production. */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADDR = "0x" + "a1".repeat(20);
const ADDR2 = "0x" + "b2".repeat(20);

let db: PGlite;

async function asApp<T>(ctx: { user: string; business?: string }, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE procura_app`);
  await db.query(`select set_config('app.current_user_id', $1, false), set_config('app.current_business_id', $2, false)`, [ctx.user, ctx.business ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
  }
}

beforeAll(async () => {
  db = await migratedPglite();
  await db.exec(`
    INSERT INTO "user"(id, name, email) VALUES ('u-a','Alice','a@x.test'), ('u-b','Bob','b@x.test');
    INSERT INTO businesses(id, name, slug, country_code, default_currency) VALUES
      ('${A}','Alice','alice','NG','USD'), ('${B}','Bob','bob','NG','USD');
    INSERT INTO business_members(business_id, user_id, role) VALUES ('${A}','u-a','owner'), ('${B}','u-b','owner');
    INSERT INTO business_wallets(business_id, linked_by, address, chain_id) VALUES ('${B}','u-b','${ADDR2}', 2368);
  `);
});

afterAll(async () => { await db.close(); });

const link = (business: string, user: string, address = ADDR) =>
  db.query(`insert into business_wallets(business_id, linked_by, address, chain_id) values ($1,$2,$3,2368)`, [business, user, address]);

describe("business_wallets", () => {
  it("a tenant sees only its own wallets and cannot write into another tenant", async () => {
    await asApp({ user: "u-a", business: A }, () => link(A, "u-a"));
    const rows = await asApp({ user: "u-a", business: A }, async () => (await db.query<{ address: string }>(`select address from business_wallets`)).rows);
    expect(rows.map((r) => r.address)).toEqual([ADDR]);
    await expect(asApp({ user: "u-a", business: A }, () => link(B, "u-a", "0x" + "c3".repeat(20)))).rejects.toThrow(/row-level security/i);
  });

  it("the same address cannot be actively linked twice, but can be linked again after revocation", async () => {
    await expect(asApp({ user: "u-a", business: A }, () => link(A, "u-a"))).rejects.toThrow(/duplicate key|unique/i);
    await asApp({ user: "u-a", business: A }, () =>
      db.query(`update business_wallets set status='revoked', revoked_at=now(), revoked_by='u-a' where address=$1`, [ADDR]));
    await asApp({ user: "u-a", business: A }, () => link(A, "u-a"));
    const { rows } = await db.query<{ n: string }>(`select count(*)::text n from business_wallets where business_id='${A}' and address='${ADDR}'`);
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("a linked wallet's address, chain and owner can never be edited", async () => {
    for (const set of [`address='${"0x" + "d4".repeat(20)}'`, `chain_id=2366`, `linked_by='u-b'`, `business_id='${B}'`]) {
      await expect(asApp({ user: "u-a", business: A }, () => db.query(`update business_wallets set ${set} where business_id='${A}' and status='active'`)))
        .rejects.toThrow();
    }
  });

  it("a revoked wallet cannot be re-activated and rows cannot be deleted by the app", async () => {
    await expect(asApp({ user: "u-a", business: A }, () => db.query(`update business_wallets set status='active', revoked_at=null where status='revoked'`)))
      .rejects.toThrow();
    await expect(asApp({ user: "u-a", business: A }, () => db.query(`delete from business_wallets where business_id='${A}'`))).rejects.toThrow(/permission denied/i);
  });

  it("rejects malformed addresses and revoking without a timestamp", async () => {
    await expect(asApp({ user: "u-a", business: A }, () => link(A, "u-a", "0xNOTHEX"))).rejects.toThrow(/check/i);
    await expect(asApp({ user: "u-a", business: A }, () => link(A, "u-a", "0x" + "A1".repeat(20)))).rejects.toThrow(/check/i);
    await expect(asApp({ user: "u-a", business: A }, () =>
      db.query(`update business_wallets set status='revoked' where status='active' and business_id='${A}'`))).rejects.toThrow(/check/i);
  });
});
