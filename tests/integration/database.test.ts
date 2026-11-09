import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real migrations against an in-process Postgres (PGlite) and attacks the guarantees
 * the Technical PRD relies on: tenant isolation, append-only audit data, duplicate-payment
 * prevention and payment integrity. Postgres superusers bypass RLS, so every isolation check
 * runs as the non-owner `procura_app` role, exactly like the deployed app.
 */

const MIGRATIONS = join(__dirname, "../../packages/database/migrations");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let db: PGlite;

async function asApp<T>(ctx: { user: string; business?: string }, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE procura_app`);
  await db.query(`select set_config('app.current_user_id', $1, false), set_config('app.current_business_id', $2, false)`, [
    ctx.user, ctx.business ?? "",
  ]);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE procura_app NOLOGIN`);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) await db.exec(stmt);
    }
  }

  // Seed as superuser (bypasses RLS) - two tenants with one user each.
  await db.exec(`
    INSERT INTO "user"(id, name, email) VALUES ('u-a','Alice','a@x.test'), ('u-b','Bob','b@x.test');
    INSERT INTO businesses(id, name, slug, country_code, default_currency) VALUES
      ('${A}','Alice','alice','NG','USD'), ('${B}','Bob','bob','NG','USD');
    INSERT INTO business_members(business_id, user_id, role) VALUES ('${A}','u-a','owner'), ('${B}','u-b','owner');
    INSERT INTO suppliers(id, business_id, name) VALUES
      ('00000000-0000-4000-8000-00000000000a','${A}','Greenfield'), ('00000000-0000-4000-8000-00000000000b','${B}','Hidden Supplier');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("migrations", () => {
  it("apply cleanly and create every table", async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.tables where table_schema='public'`,
    );
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(24);
  });
});

describe("tenant isolation (RLS)", () => {
  it("control: the owner/superuser sees both tenants, so the checks below are meaningful", async () => {
    const { rows } = await db.query(`select 1 from suppliers`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("a tenant sees only its own rows", async () => {
    const rows = await asApp({ user: "u-a", business: A }, async () =>
      (await db.query<{ name: string }>(`select name from suppliers`)).rows,
    );
    expect(rows.map((r) => r.name)).toEqual(["Greenfield"]);
  });

  it("with no tenant context, nothing is visible", async () => {
    const rows = await asApp({ user: "u-a" }, async () => (await db.query(`select * from suppliers`)).rows);
    expect(rows).toHaveLength(0);
  });

  it("a tenant cannot read another tenant even by guessing the id", async () => {
    const rows = await asApp({ user: "u-a", business: A }, async () =>
      (await db.query(`select * from suppliers where id = '00000000-0000-4000-8000-00000000000b'`)).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("a tenant cannot write into another tenant", async () => {
    await expect(
      asApp({ user: "u-a", business: A }, () =>
        db.query(`insert into suppliers(business_id, name) values ('${B}', 'Injected')`),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a tenant cannot move its row to another tenant, and cannot update or delete foreign rows", async () => {
    await expect(
      asApp({ user: "u-a", business: A }, () => db.query(`update suppliers set business_id='${B}' where business_id='${A}'`)),
    ).rejects.toThrow(/row-level security/i);

    const upd = await asApp({ user: "u-a", business: A }, () =>
      db.query(`update suppliers set name='Pwned' where business_id='${B}'`),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await asApp({ user: "u-a", business: A }, () => db.query(`delete from suppliers where business_id='${B}'`));
    expect(del.affectedRows).toBe(0);
  });

  it("a user can list their own memberships without a business context, but not others'", async () => {
    const rows = await asApp({ user: "u-a" }, async () =>
      (await db.query<{ business_id: string }>(`select business_id from business_members`)).rows,
    );
    expect(rows.map((r) => r.business_id)).toEqual([A]);

    const bizs = await asApp({ user: "u-a" }, async () => (await db.query<{ name: string }>(`select name from businesses`)).rows);
    expect(bizs.map((r) => r.name)).toEqual(["Alice"]);
  });

  it("a user cannot add themselves to a business they are not in", async () => {
    await expect(
      asApp({ user: "u-a", business: A }, () =>
        db.query(`insert into business_members(business_id, user_id, role) values ('${B}','u-a','owner')`),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a new business can only be created under its own pre-set id", async () => {
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await asApp({ user: "u-a", business: C }, async () => {
      await db.query(`insert into businesses(id, name, slug, country_code, default_currency) values ('${C}','New Co','new-co','NG','USD')`);
      await db.query(`insert into business_members(business_id, user_id, role) values ('${C}','u-a','owner')`);
    });
    await expect(
      asApp({ user: "u-a", business: C }, () =>
        db.query(`insert into businesses(id, name, slug, country_code, default_currency) values (gen_random_uuid(),'Sneaky','sneaky','NG','USD')`),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("append-only audit data", () => {
  it("audit_logs can be inserted but never updated or deleted, even by a superuser", async () => {
    await db.exec(`insert into audit_logs(id, business_id, actor_type, action, resource_type)
                   values ('00000000-0000-4000-8000-0000000000a1','${A}','system','test','test')`);
    await expect(db.exec(`update audit_logs set action='tampered'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`delete from audit_logs`)).rejects.toThrow(/append-only/);
  });

  it("the application role has no UPDATE or DELETE privilege on audit_logs at all", async () => {
    await expect(
      asApp({ user: "u-a", business: A }, () => db.query(`update audit_logs set action='tampered'`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("monetary integrity", () => {
  it("rejects a quotation whose total does not equal its parts", async () => {
    await db.exec(`insert into procurement_requests(id, business_id, request_number, title, budget_amount, currency)
                   values ('00000000-0000-4000-8000-0000000000c1','${A}','PR-0001','Restock',2000,'USD')`);
    await expect(
      db.exec(`insert into quotations(business_id, request_id, supplier_id, subtotal, delivery_cost, additional_costs, total_cost, currency)
               values ('${A}','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000000a',1580,50,0,1600,'USD')`),
    ).rejects.toThrow(/quotations_total_chk/);
    await db.exec(`insert into quotations(business_id, request_id, supplier_id, subtotal, delivery_cost, additional_costs, total_cost, currency)
                   values ('${A}','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000000a',1580,50,0,1630,'USD')`);
  });

  it("rejects a spending policy whose per-transaction limit exceeds its total", async () => {
    await expect(
      db.exec(`insert into spending_policies(business_id, max_total_spend, max_transaction_amount, currency)
               values ('${A}', 1000, 2000, 'USD')`),
    ).rejects.toThrow(/spending_policies_limits_chk/);
  });
});

describe("payment safety", () => {
  const PO = "00000000-0000-4000-8000-0000000000d1";
  const SUP = "00000000-0000-4000-8000-00000000000a";
  const pay = (key: string, status = "prepared", extra = "") =>
    `insert into payments(business_id, purchase_order_id, supplier_id, idempotency_key, recipient_address, asset, network, amount, status ${extra ? "," + extra.split("|")[0] : ""})
     values ('${A}','${PO}','${SUP}','${key}','0xabc','USDC.e','kite',1630,'${status}' ${extra ? "," + extra.split("|")[1] : ""})`;

  beforeAll(async () => {
    await db.exec(`insert into purchase_orders(id, business_id, request_id, supplier_id, order_number, subtotal, delivery_cost, total_amount, currency, payment_asset, payment_amount)
                   values ('${PO}','${A}','00000000-0000-4000-8000-0000000000c1','${SUP}','PO-0001',1580,50,1630,'USD','USDC.e',1630)`);
  });

  it("allows only one live payment per purchase order", async () => {
    await db.exec(pay("k1"));
    await expect(db.exec(pay("k2"))).rejects.toThrow(/payments_one_live_per_po/);
  });

  it("rejects a reused idempotency key", async () => {
    await expect(db.exec(pay("k1", "failed"))).rejects.toThrow(/payments_idempotency_key_unique|duplicate key/);
  });

  it("refuses to jump from prepared to confirmed", async () => {
    await expect(
      db.exec(`update payments set status='confirmed', confirmed_at=now(), transaction_hash='0xhash' where idempotency_key='k1'`),
    ).rejects.toThrow(/Invalid payment transition prepared -> confirmed/);
  });

  it("walks the legal path, and a confirmed payment must carry a hash and time", async () => {
    await db.exec(`update payments set status='awaiting_authorisation' where idempotency_key='k1'`);
    await db.exec(`update payments set status='authorised' where idempotency_key='k1'`);
    await db.exec(`update payments set status='submitted' where idempotency_key='k1'`);
    await expect(db.exec(`update payments set status='confirmed' where idempotency_key='k1'`)).rejects.toThrow(/payments_confirmed_chk/);
    await db.exec(`update payments set status='confirmed', confirmed_at=now(), transaction_hash='0x9f3c' where idempotency_key='k1'`);
  });

  it("makes a confirmed payment terminal and blocks changes to what was paid", async () => {
    await expect(db.exec(`update payments set status='failed' where idempotency_key='k1'`)).rejects.toThrow(/Invalid payment transition/);
    await expect(db.exec(`update payments set amount=1 where idempotency_key='k1'`)).rejects.toThrow(/immutable/);
    await expect(db.exec(`update payments set recipient_address='0xattacker' where idempotency_key='k1'`)).rejects.toThrow(/immutable/);
  });

  it("frees the slot after a failed attempt so a retry can be made", async () => {
    // New PO + payment to prove: failed attempt releases the unique slot.
    const PO2 = "00000000-0000-4000-8000-0000000000d2";
    await db.exec(`insert into purchase_orders(id, business_id, request_id, supplier_id, order_number, subtotal, delivery_cost, total_amount, currency, payment_asset, payment_amount)
                   values ('${PO2}','${A}','00000000-0000-4000-8000-0000000000c1','${SUP}','PO-0002',100,0,100,'USD','USDC.e',100)`);
    const ins = (key: string) => `insert into payments(business_id, purchase_order_id, supplier_id, idempotency_key, recipient_address, asset, network, amount)
                                  values ('${A}','${PO2}','${SUP}','${key}','0xabc','USDC.e','kite',100)`;
    await db.exec(ins("r1"));
    await db.exec(`update payments set status='awaiting_authorisation' where idempotency_key='r1'`);
    await db.exec(`update payments set status='failed', failure_reason='session expired' where idempotency_key='r1'`);
    await db.exec(ins("r2"));
  });
});
