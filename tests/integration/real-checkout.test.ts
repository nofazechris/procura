import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@procura/database/schema";
import { withTenant } from "@procura/database";
import { fingerprintFor, simulateCheckout } from "@procura/procurement";
import { MARKETPLACE_RECIPIENT } from "@procura/policies";
import { ServiceError } from "@procura/shared";
import { migratedPglite } from "../helpers/pg";

/**
 * Real checkout and real calls, run end to end against real Postgres as the restricted app role, with a
 * fake `kpass`. No money moves and nobody is called, but every rule that stands between a person and a
 * real charge or a real phone call is exercised: what must hold before it, and what is recorded after.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUP = "30000000-0000-4000-8000-000000000001";
const PHONE_SUP = "30000000-0000-4000-8000-000000000002";
const DEMO_SUP = "30000000-0000-4000-8000-000000000003";
const NOW = new Date();
const access = { userId: "u-a", email: "a@x.test", name: "Alice", businessId: A, role: "owner" as const };
const ASIN = "B0CXYYWL6G";

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
let live: typeof import("../../apps/web/lib/server/checkout-live");
let calls: typeof import("../../apps/web/lib/server/calls");
let passport: typeof import("../../apps/web/lib/server/passport");

/** Seed as the owner, then go back to the restricted role every real query runs as. */
async function seed(sql: string) {
  await pg.exec("RESET ROLE");
  try { await pg.exec(sql); } finally { await pg.exec("SET ROLE procura_app"); }
}

interface Fake {
  wallet: string;
  cartPrice: string;
  checkout: { exitCode: number; json: Record<string, unknown> };
  log: string[][];
}
let fake: Fake;
const fresh = (over: Partial<Fake> = {}): Fake => ({
  wallet: "8.00", cartPrice: "$4.50",
  checkout: { exitCode: 0, json: { order_id: "ord_1", order_status: "pending", destination_tx_hash: "0xabc", total_amount: "$8.00", chain: "base" } },
  log: [], ...over,
});

function install() {
  passport.setKpassExecutor(async (args) => {
    fake.log.push(args);
    const [cmd, sub] = args;
    if (cmd === "wallet" && sub === "balance") return { exitCode: 0, json: { assets: [{ asset: "USDC", total: fake.wallet }] } };
    if (cmd === "shop:shipping" && sub === "view") return { exitCode: 0, json: { name: "Jane Doe", email: "j@x.test", line1: "1 Main", city: "Austin", state: "TX", postal_code: "78701", country: "US", missing: [], complete: true } };
    if (cmd === "shop:shipping" && sub === "update") return { exitCode: 0, json: { missing: [], complete: true } };
    if (cmd === "shop:cart" && sub === "view") return { exitCode: 0, json: { items: [{ provider: "amazon", external_identifier: ASIN, title: "Charger", price: fake.cartPrice, quantity: 1 }] } };
    if (cmd === "shop:cart") return { exitCode: 0, json: {} };
    if (cmd === "shop:checkout") return fake.checkout;
    if (cmd === "session" && sub === "execute") return { exitCode: 0, json: { x402: { status_code: 200, parsed_response_body: { success: true, call_id: "call-123" } }, payment_requirement: { amount: "0.54" } } };
    return { exitCode: 1, json: null };
  });
}

let n = 0;
/** An approved Amazon order for one $4.50 charger, with the approval fingerprint as the real flow stores it. */
async function approvedOrder(): Promise<string> {
  n++;
  const req = `10000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const quote = `20000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const po = `40000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  await seed(`
    INSERT INTO procurement_requests(id, business_id, request_number, title, status, budget_amount, currency, priority) VALUES ('${req}','${A}','PR-70${n}','Charger','approved',20,'USD','price');
    INSERT INTO quotations(id, business_id, request_id, supplier_id, subtotal, delivery_cost, additional_costs, total_cost, currency, line_items, source_type, quote_status, availability_status)
      VALUES ('${quote}','${A}','${req}','${SUP}',4.5,0,0,4.5,'USD',
        '[{"description":"USB-C charger","quantity":"1","unitPrice":"4.50","listing":{"id":"${ASIN}","title":"Charger","link":"https://www.amazon.com/dp/${ASIN}","rating":4.5,"reviews":100}}]'::jsonb,'marketplace','selected','available');
    INSERT INTO purchase_orders(id, business_id, request_id, supplier_id, quotation_id, order_number, subtotal, delivery_cost, total_amount, currency, payment_asset, payment_amount, status)
      VALUES ('${po}','${A}','${req}','${SUP}','${quote}','PO-70${n}',4.5,0,4.5,'USD','USDC.e',4.5,'approved');
    INSERT INTO purchase_order_items(business_id, purchase_order_id, description, quantity, unit_price, total_price, currency) VALUES ('${A}','${po}','USB-C charger',1,4.5,4.5,'USD');
  `);
  await pg.exec("RESET ROLE");
  const [row] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po));
  const fp = await db.transaction((tx) => fingerprintFor(tx as never, row!, MARKETPLACE_RECIPIENT));
  await pg.exec("SET ROLE procura_app");
  await seed(`UPDATE purchase_orders SET approved_fingerprint='${fp}', approved_by='u-a', approved_at=now() WHERE id='${po}'`);
  return po;
}

const SESSION = "50000000-0000-4000-8000-000000000001";
const SMALL = "50000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
  process.env.PASSPORT_HOME = "C:/tmp/passport";
  process.env.PASSPORT_BUSINESS_ID = A;
  pg = await migratedPglite();
  db = drizzle(pg, { schema });
  (globalThis as { __procuraDb?: unknown }).__procuraDb = db;
  passport = await import("../../apps/web/lib/server/passport");
  live = await import("../../apps/web/lib/server/checkout-live");
  calls = await import("../../apps/web/lib/server/calls");
  await pg.exec(`
    INSERT INTO "user"(id, name, email) VALUES ('u-a','Alice','a@x.test');
    INSERT INTO businesses(id, name, slug, country_code, default_currency) VALUES ('${A}','Alice','alice','NG','USD');
    INSERT INTO business_members(business_id, user_id, role) VALUES ('${A}','u-a','owner');
    INSERT INTO spending_policies(business_id, max_total_spend, max_transaction_amount, currency, approval_required_above) VALUES ('${A}', 500, 150, 'USD', 50);
    INSERT INTO suppliers(id, business_id, name, source_type, external_ref) VALUES ('${SUP}','${A}','Amazon: Cheapest picks','marketplace','amazon:cheapest');
    INSERT INTO suppliers(id, business_id, name, phone, source_type) VALUES ('${PHONE_SUP}','${A}','Ikeja Office Supply','+234 801 234 5678','manual');
    INSERT INTO suppliers(id, business_id, name, phone, source_type) VALUES ('${DEMO_SUP}','${A}','Fictional Ltd','+234 801 234 0000','demo');
    INSERT INTO spending_sessions(id, business_id, task_summary, requested_amount, max_amount_per_transaction, max_total_amount, asset, status, passport_session_reference, expires_at)
      VALUES ('${SESSION}','${A}','test',10,10,10,'USD','active','sess_ok', now() + interval '1 hour'),
             ('${SMALL}','${A}','small',2,2,2,'USD','active','sess_small', now() + interval '1 hour');
    SET ROLE procura_app;
  `);
});
afterAll(async () => { (globalThis as { __procuraDb?: unknown }).__procuraDb = undefined; await pg.close(); });
afterEach(() => passport.setKpassExecutor());

async function expectError(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, `expected ServiceError ${code}`).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).code).toBe(code);
  return err as ServiceError;
}
const ranCheckout = () => fake.log.some((a) => a[0] === "shop:checkout");
const row = async <T extends object>(sql: string) => { await pg.exec("RESET ROLE"); try { return (await pg.query<T>(sql)).rows; } finally { await pg.exec("SET ROLE procura_app"); } };

describe("real checkout", () => {
  it("pays an approved order: the right ceiling for a small wallet, recorded as paid, and the cart left empty", async () => {
    fake = fresh(); install();
    const po = await approvedOrder();
    const r = await live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true });
    expect(r).toMatchObject({ status: "paid", orderId: "ord_1", txHash: "0xabc", held: "8.00", ceiling: "7.00" });

    const co = fake.log.find((a) => a[0] === "shop:checkout")!;
    expect(co).toEqual(expect.arrayContaining(["--confirmed", "--session-id", "sess_ok", "--max-total", "7.00"]));
    expect(fake.log.filter((a) => a[0] === "shop:cart").map((a) => a[1])).toEqual(["clear", "add", "view", "clear"]);

    const [o] = await row<{ status: string }>(`select status from purchase_orders where id='${po}'`);
    expect(o!.status).toBe("paid");
    const [p] = await row<{ status: string; network: string; amount: string; provider_reference: string; transaction_hash: string }>(`select status, network, amount::text, provider_reference, transaction_hash from payments where purchase_order_id='${po}'`);
    expect(p).toMatchObject({ status: "confirmed", network: "base", provider_reference: "ord_1", transaction_hash: "0xabc" });
    expect(Number(p!.amount)).toBe(8);
    const [rq] = await row<{ status: string }>(`select status from procurement_requests where id=(select request_id from purchase_orders where id='${po}')`);
    expect(rq!.status).toBe("processing");
    const audit = await row<{ action: string }>(`select action from audit_logs where resource_id in (select id::text from payments where purchase_order_id='${po}') order by created_at`);
    expect(audit.map((x) => x.action)).toEqual(["payment.live_submitted", "payment.live_confirmed"]);
  });

  it("charges nothing unless the person confirmed", async () => {
    fake = fresh(); install();
    const po = await approvedOrder();
    await expectError(live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: false }), "NOT_CONFIRMED");
    expect(fake.log).toHaveLength(0);
  });

  it("refuses when the wallet cannot cover the items plus the fee, and says by how much", async () => {
    fake = fresh({ wallet: "4.00" }); install();
    const po = await approvedOrder();
    const e = await expectError(live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true }), "WALLET_TOO_LOW");
    expect(e.message).toMatch(/\$1\.50 more/);
    expect(ranCheckout()).toBe(false);
  });

  it("refuses a session smaller than the up-front charge", async () => {
    fake = fresh(); install();
    const po = await approvedOrder();
    await expectError(live.runLiveCheckout(access, po, { sessionId: SMALL, confirmed: true }), "SESSION_TOO_SMALL");
    expect(ranCheckout()).toBe(false);
  });

  it("refuses an order that changed after it was approved", async () => {
    fake = fresh(); install();
    const po = await approvedOrder();
    await seed(`UPDATE purchase_order_items SET unit_price = 4.51, total_price = 4.51 WHERE purchase_order_id='${po}'`);
    const e = await expectError(live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true }), "CHECKOUT_BLOCKED");
    expect(JSON.stringify(e.details)).toContain("ORDER_CHANGED_AFTER_APPROVAL");
    expect(ranCheckout()).toBe(false);
    const [o] = await row<{ status: string }>(`select status from purchase_orders where id='${po}'`);
    expect(o!.status).toBe("approved");
  });

  it("refuses when Amazon's price is no longer what was compared, and clears the cart", async () => {
    fake = fresh({ cartPrice: "$5.25" }); install();
    const po = await approvedOrder();
    await expectError(live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true }), "PRICES_CHANGED");
    expect(ranCheckout()).toBe(false);
    expect(fake.log.filter((a) => a[0] === "shop:cart").map((a) => a[1]).at(-1)).toBe("clear");
  });

  it("a failed payment is recorded as failed and can be tried again", async () => {
    fake = fresh({ checkout: { exitCode: 6, json: { error_code: "wallet_empty" } } }); install();
    const po = await approvedOrder();
    await expectError(live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true }), "CHECKOUT_FAILED");
    const [p] = await row<{ status: string }>(`select status from payments where purchase_order_id='${po}'`);
    const [o] = await row<{ status: string }>(`select status from purchase_orders where id='${po}'`);
    expect(p!.status).toBe("failed");
    expect(o!.status).toBe("awaiting_payment");

    fake = fresh(); install();
    const again = await live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true });
    expect(again.status).toBe("paid");
  });

  it("an unknown outcome keeps the payment pending and blocks a second charge", async () => {
    fake = fresh({ checkout: { exitCode: 1, json: { error_code: "shop_checkout_in_flight" } } }); install();
    const po = await approvedOrder();
    await expectError(live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true }), "PAYMENT_UNKNOWN");
    const [p] = await row<{ status: string }>(`select status from payments where purchase_order_id='${po}'`);
    expect(p!.status).toBe("pending");

    fake = fresh(); install();
    // The order is stuck at "payment pending", so it cannot be paid again until the first attempt is resolved.
    await expectError(live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true }), "INVALID_STATE");
    expect(ranCheckout()).toBe(false);
  });

  it("a practice run does not stand in the way of the real payment", async () => {
    fake = fresh(); install();
    const po = await approvedOrder();
    await withTenant({ userId: "u-a", businessId: A }, (tx) => simulateCheckout(tx, { businessId: A, userId: "u-a", now: NOW }, po));
    const r = await live.runLiveCheckout(access, po, { sessionId: SESSION, confirmed: true });
    expect(r.status).toBe("paid");
  });

  it("an order from another business is not found", async () => {
    fake = fresh(); install();
    const po = await approvedOrder();
    await expectError(live.runLiveCheckout({ ...access, businessId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, po, { sessionId: SESSION, confirmed: true }), "PASSPORT_NOT_ENABLED");
  });
});

describe("real calls", () => {
  const script = { opening: "Hi", questions: ["How much for 50 bags?", "We will pay a deposit today."], mustConfirm: ["the total"], closing: "Thanks" };

  it("phones the saved number, opening as an AI, with a payment promise stripped out", async () => {
    fake = fresh(); install();
    const r = await calls.placeSellerCall(access, PHONE_SUP, { sessionId: SESSION, script, confirmed: true });
    expect(r).toMatchObject({ callId: "call-123", phone: "ending 5678", price: "0.54" });
    const exec = fake.log.find((a) => a[0] === "session" && a[1] === "execute")!;
    expect(exec).toEqual(expect.arrayContaining(["--url", "https://stablephone.dev/api/call", "--method", "POST", "--session-id", "sess_ok"]));
    const body = JSON.parse(exec[exec.indexOf("--body") + 1]!) as Record<string, unknown>;
    expect(body).toMatchObject({ phone_number: "+2348012345678", record: false, max_duration: 3 });
    expect(String(body["first_sentence"])).toMatch(/AI assistant/);
    expect(String(body["task"])).toContain("How much for 50 bags?");
    expect(String(body["task"])).not.toContain("deposit");
    const logged = await calls.listCalls(access, PHONE_SUP);
    expect(logged[0]).toMatchObject({ callId: "call-123", phone: "ending 5678" });
  });

  it("does nothing unless the person confirmed", async () => {
    fake = fresh(); install();
    await expectError(calls.placeSellerCall(access, PHONE_SUP, { sessionId: SESSION, script, confirmed: false }), "NOT_CONFIRMED");
    expect(fake.log).toHaveLength(0);
  });

  it("never calls a demo seller, a marketplace, or a seller with no usable number", async () => {
    fake = fresh(); install();
    await expectError(calls.placeSellerCall(access, DEMO_SUP, { sessionId: SESSION, script, confirmed: true }), "SELLER_NOT_CALLABLE");
    await expectError(calls.placeSellerCall(access, SUP, { sessionId: SESSION, script, confirmed: true }), "SELLER_NOT_CALLABLE");
    await seed(`UPDATE suppliers SET phone='08012345678' WHERE id='${PHONE_SUP}'`);
    await expectError(calls.placeSellerCall(access, PHONE_SUP, { sessionId: SESSION, script, confirmed: true }), "PHONE_MISSING");
    await seed(`UPDATE suppliers SET phone='+234 801 234 5678' WHERE id='${PHONE_SUP}'`);
    expect(fake.log).toHaveLength(0);
  });

  it("a number the service refuses is reported plainly and nothing is recorded as placed", async () => {
    fake = fresh(); install();
    passport.setKpassExecutor(async () => ({ exitCode: 0, json: { x402: { status_code: 403, response_body: "dnc" } } }));
    const before = (await calls.listCalls(access, PHONE_SUP)).length;
    const e = await expectError(calls.placeSellerCall(access, PHONE_SUP, { sessionId: SESSION, script, confirmed: true }), "CALL_NOT_PLACED");
    expect(e.message).toMatch(/Do-Not-Call/);
    expect((await calls.listCalls(access, PHONE_SUP)).length).toBe(before);
  });
});
