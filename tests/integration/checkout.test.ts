import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@procura/database/schema";
import { approveOrder, SIMULATION_NETWORK, simulateCheckout, type ServiceContext } from "@procura/procurement";
import { amazonCheckoutLimits, exceedsCap, MARKETPLACE_RECIPIENT, settleCheckout } from "@procura/policies";
import { ServiceError } from "@procura/shared";
import { migratedPglite } from "../helpers/pg";

/** The practice checkout, run against real Postgres as the restricted app role, exactly like production. */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-11-04T09:00:00Z");
const ctx: ServiceContext = { businessId: A, userId: "u-a", now: NOW };
const SUP = "30000000-0000-4000-8000-000000000001";
const REQ = "10000000-0000-4000-8000-000000000011";
const PO = "40000000-0000-4000-8000-000000000001";
const REQ2 = "10000000-0000-4000-8000-000000000012";
const PO2 = "40000000-0000-4000-8000-000000000002";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

async function asApp<T>(fn: (tx: PgliteDatabase<typeof schema>) => Promise<T>): Promise<T> {
  await pg.exec(`SET ROLE procura_app`);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(`select set_config('app.current_user_id', 'u-a', true), set_config('app.current_business_id', '${A}', true)` as never);
      return fn(tx as unknown as PgliteDatabase<typeof schema>);
    });
  } finally { await pg.exec(`RESET ROLE`); }
}

async function expectError(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, `expected ServiceError ${code}`).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).code).toBe(code);
  return err as ServiceError;
}

async function order(id: string, request: string, number: string, subtotal: number, delivery = 0) {
  await pg.exec(`
    INSERT INTO procurement_requests(id, business_id, request_number, title, status, budget_amount, currency, priority)
      VALUES ('${request}','${A}','PR-${number}','Charger','awaiting_approval',120,'USD','price');
    INSERT INTO purchase_orders(id, business_id, request_id, supplier_id, order_number, subtotal, delivery_cost, total_amount, currency, payment_asset, payment_amount, status)
      VALUES ('${id}','${A}','${request}','${SUP}','PO-${number}',${subtotal},${delivery},${subtotal + delivery},'USD','USDC.e',${subtotal + delivery},'pending_approval');
    INSERT INTO purchase_order_items(business_id, purchase_order_id, description, quantity, unit_price, total_price, currency)
      VALUES ('${A}','${id}','65W USB-C charger',2,${subtotal / 2},${subtotal},'USD');
    INSERT INTO approvals(business_id, purchase_order_id, amount, currency, status, expires_at)
      VALUES ('${A}','${id}',${subtotal + delivery},'USD','pending', '2026-11-10T00:00:00Z');
  `);
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = drizzle(pg, { schema });
  await pg.exec(`
    INSERT INTO "user"(id, name, email) VALUES ('u-a','Alice','a@x.test');
    INSERT INTO businesses(id, name, slug, country_code, default_currency) VALUES ('${A}','Alice','alice','NG','USD');
    INSERT INTO business_members(business_id, user_id, role) VALUES ('${A}','u-a','owner');
    INSERT INTO spending_policies(business_id, max_total_spend, max_transaction_amount, currency, approval_required_above)
      VALUES ('${A}', 500, 150, 'USD', 50);
    INSERT INTO suppliers(id, business_id, name, source_type, external_ref) VALUES ('${SUP}','${A}','Amazon: Cheapest picks','marketplace','amazon:cheapest');
  `);
  await order(PO, REQ, "9101", 59.98);
});

afterAll(async () => { await pg.close(); });

describe("checkout rules", () => {
  it("holds the subtotal plus the larger of 20% or $5, plus a $1 fee, and refunds what the order does not use", () => {
    const small = amazonCheckoutLimits("10.00");
    expect(small).toMatchObject({ cap: "15.00", charge: "16.00" });
    const big = amazonCheckoutLimits("100.00");
    expect(big).toMatchObject({ cap: "120.00", charge: "121.00" });
    expect(settleCheckout(big, "104.50")).toEqual({ held: "121.00", settled: "105.50", refunded: "15.50" });
  });
  it("refuses an order above the cap", () => {
    const l = amazonCheckoutLimits("100.00");
    expect(exceedsCap(l, "120.00")).toBe(false);
    expect(exceedsCap(l, "120.01")).toBe(true);
  });
});

describe("practice checkout", () => {
  it("a marketplace order can be approved with no payout address", async () => {
    const r = await asApp((tx) => approveOrder(tx, ctx, PO));
    expect(r.recipientAddress).toBe(MARKETPLACE_RECIPIENT);
  });

  it("will not check out an order that is not approved", async () => {
    await order(PO2, REQ2, "9102", 40);
    await expectError(asApp((tx) => simulateCheckout(tx, ctx, PO2)), "INVALID_STATE");
  });

  it("runs the real gate, records a practice payment, and counts no spend", async () => {
    const r = await asApp((tx) => simulateCheckout(tx, ctx, PO));
    expect(r.simulated).toBe(true);
    expect(r.reference).toMatch(/^SIM-[0-9A-F]{10}$/);
    expect(r.settlement).toEqual({ held: "72.98", settled: "60.98", refunded: "12.00" });

    const pay = await pg.query<{ network: string; status: string; amount: string; spending_session_id: string | null }>(`select network, status, amount, spending_session_id from payments where purchase_order_id='${PO}'`);
    expect(pay.rows).toHaveLength(1);
    expect(pay.rows[0]).toMatchObject({ network: SIMULATION_NETWORK, status: "confirmed", spending_session_id: null });
    // The order is not marked paid, so a practice run never uses up a budget.
    const po = await pg.query<{ status: string }>(`select status from purchase_orders where id='${PO}'`);
    expect(po.rows[0]!.status).toBe("approved");
    const audit = await pg.query<{ action: string }>(`select action from audit_logs where action='payment.simulated'`);
    expect(audit.rows).toHaveLength(1);
  });

  it("cannot be run twice for the same order", async () => {
    const err = await expectError(asApp((tx) => simulateCheckout(tx, ctx, PO)), "CHECKOUT_BLOCKED");
    const codes = ((err.details as { rejections: { code: string }[] }).rejections).map((x) => x.code);
    expect(codes).toContain("DUPLICATE_PAYMENT");
  });

  it("is refused when the order changed after it was approved", async () => {
    await pg.exec(`DELETE FROM payments WHERE purchase_order_id='${PO}'`); // owner-side cleanup; a confirmed payment cannot be cancelled
    await pg.exec(`UPDATE purchase_order_items SET unit_price = unit_price + 0.01, total_price = total_price + 0.02 WHERE purchase_order_id='${PO}'`);
    const err = await expectError(asApp((tx) => simulateCheckout(tx, ctx, PO)), "CHECKOUT_BLOCKED");
    const codes = ((err.details as { rejections: { code: string }[] }).rejections).map((x) => x.code);
    expect(codes).toContain("ORDER_CHANGED_AFTER_APPROVAL");
    const none = await pg.query(`select 1 from payments where purchase_order_id='${PO}' and status='confirmed'`);
    expect(none.rows).toHaveLength(0);
  });

  it("is refused when shipping and tax push the order above the cap", async () => {
    const R3 = "10000000-0000-4000-8000-000000000013", PO3 = "40000000-0000-4000-8000-000000000003";
    await order(PO3, R3, "9103", 40, 20);
    await pg.exec(`UPDATE purchase_orders SET status='approved', approved_by='u-a', approved_at=now(), approved_fingerprint='x' WHERE id='${PO3}'`);
    await expectError(asApp((tx) => simulateCheckout(tx, ctx, PO3)), "CHECKOUT_ABOVE_CAP");
  });

  it("only sees its own orders", async () => {
    await expectError(asApp((tx) => simulateCheckout(tx, { ...ctx, businessId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, PO)), "NOT_FOUND");
    void eq; // keep the drizzle import honest
  });
});
