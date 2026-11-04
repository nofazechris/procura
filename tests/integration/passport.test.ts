import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migratedPglite } from "../helpers/pg";

/** passport_agents guarantees, attacked as the non-owner app role exactly like production. */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
      ('${A}','Northstar Kitchen','northstar','NG','USD'), ('${B}','Rival Foods','rival','NG','USD');
    INSERT INTO passport_agents(business_id, agent_type, passport_agent_id, passport_owner_id, registered_by)
      VALUES ('${B}','procura-agent','agent_b','owner_b','u-b');
  `);
});

afterAll(async () => { await db.close(); });

const register = (business: string, user: string, agent: string) =>
  db.query(`insert into passport_agents(business_id, agent_type, passport_agent_id, passport_owner_id, registered_by) values ($1,'procura-agent',$2,'owner',$3)`, [business, agent, user]);

describe("passport_agents", () => {
  it("a tenant sees only its own agent identities and cannot write into another tenant", async () => {
    await asApp({ user: "u-a", business: A }, () => register(A, "u-a", "agent_a"));
    const rows = await asApp({ user: "u-a", business: A }, async () => (await db.query<{ passport_agent_id: string }>(`select passport_agent_id from passport_agents`)).rows);
    expect(rows.map((r) => r.passport_agent_id)).toEqual(["agent_a"]);
    await expect(asApp({ user: "u-a", business: A }, () => register(B, "u-a", "agent_x"))).rejects.toThrow(/row-level security/i);
  });

  it("the same agent cannot be recorded twice for a business", async () => {
    await expect(asApp({ user: "u-a", business: A }, () => register(A, "u-a", "agent_a"))).rejects.toThrow(/duplicate key|unique/i);
  });

  it("the app can neither rewrite nor delete an identity record", async () => {
    await expect(asApp({ user: "u-a", business: A }, () => db.query(`update passport_agents set passport_agent_id='agent_evil' where business_id='${A}'`))).rejects.toThrow(/permission denied/i);
    await expect(asApp({ user: "u-a", business: A }, () => db.query(`delete from passport_agents where business_id='${A}'`))).rejects.toThrow(/permission denied/i);
  });
});

describe("spending sessions carry the Passport request they are waiting on", () => {
  it("stores the request id and moves from awaiting approval to active, isolated per tenant", async () => {
    await asApp({ user: "u-a", business: A }, () => db.query(
      `insert into spending_sessions(business_id, task_summary, requested_amount, max_amount_per_transaction, max_total_amount, asset, status, passport_request_id)
       values ('${A}','demo',5,1,5,'USD','awaiting_user_approval','req_1')`));
    await asApp({ user: "u-a", business: A }, () => db.query(`update spending_sessions set status='active', passport_session_reference='sess_1' where passport_request_id='req_1'`));
    const mine = await asApp({ user: "u-a", business: A }, async () => (await db.query<{ status: string }>(`select status from spending_sessions`)).rows);
    expect(mine.map((r) => r.status)).toEqual(["active"]);
    const theirs = await asApp({ user: "u-b", business: B }, async () => (await db.query(`select * from spending_sessions`)).rows);
    expect(theirs).toHaveLength(0);
  });
});
