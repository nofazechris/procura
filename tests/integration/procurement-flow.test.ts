import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@procura/database/schema";
import {
  approveOrder, approvePayoutDestination, createPurchaseOrder, DemoSupplierProvider, fingerprintFor,
  loadComparison, rejectOrder, runSourcing, type ServiceContext,
} from "@procura/procurement";
import { ServiceError } from "@procura/shared";
import { migratedPglite } from "../helpers/pg";

/**
 * Runs the real services against real Postgres as the restricted `procura_app` role, so Row Level
 * Security is in force exactly as in production.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-03T09:00:00Z");
const CONVERSION = { rate: "1.000000", asOf: new Date("2026-11-03T08:45:00Z"), source: "fixed 1:1 demo peg" };

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

const ctxA: ServiceContext = { businessId: A, userId: "u-a", now: NOW };

/** Run inside a transaction as the app role with the tenant context set, like withTenant(). */
async function asApp<T>(who: { userId: string; businessId: string }, fn: (tx: PgliteDatabase<typeof schema>) => Promise<T>): Promise<T> {
  await pg.exec(`SET ROLE procura_app`);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        `select set_config('app.current_user_id', '${who.userId}', true), set_config('app.current_business_id', '${who.businessId}', true)` as never,
      );
      return fn(tx as unknown as PgliteDatabase<typeof schema>);
    });
  } finally {
    await pg.exec(`RESET ROLE`);
  }
}

async function expectServiceError(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, `expected ServiceError ${code}`).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).code).toBe(code);
  return err as ServiceError;
}

async function newRequest(id: string, number: string, status = "draft") {
  await pg.exec(`
    INSERT INTO procurement_requests(id, business_id, request_number, title, status, budget_amount, currency, priority)
      VALUES ('${id}','${A}','${number}','Kitchen restock','${status}',2000,'USD','price');
    INSERT INTO procurement_items(business_id, request_id, product_name, category, quantity, unit) VALUES
      ('${A}','${id}','Premium basmati rice','food',50,'bags'),
      ('${A}','${id}','Vegetable oil','food',20,'cartons'),
      ('${A}','${id}','Frozen chicken','food',10,'cartons');
  `);
}

const R1 = "10000000-0000-4000-8000-000000000001";
const R2 = "10000000-0000-4000-8000-000000000002";
const R3 = "10000000-0000-4000-8000-000000000003";

beforeAll(async () => {
  pg = await migratedPglite();
  db = drizzle(pg, { schema });
  await pg.exec(`
    INSERT INTO "user"(id, name, email) VALUES ('u-a','Alice','a@x.test'), ('u-b','Bob','b@x.test');
    INSERT INTO businesses(id, name, slug, country_code, default_currency) VALUES
      ('${A}','Northstar Kitchen','northstar','NG','USD'), ('${B}','Rival Foods','rival','NG','USD');
    INSERT INTO business_members(business_id, user_id, role) VALUES ('${A}','u-a','owner'), ('${B}','u-b','owner');
    INSERT INTO spending_policies(business_id, max_total_spend, max_transaction_amount, currency, approval_required_above)
      VALUES ('${A}', 20000, 2500, 'USD', 500);
  `);
  await newRequest(R1, "PR-9001");
  await newRequest(R2, "PR-9002");
  await newRequest(R3, "PR-9003");
});

afterAll(async () => { await pg.close(); });

describe("sourcing", () => {
  const provider = new DemoSupplierProvider();

  it("discovers the three demo suppliers and collects three quotations, moving the request to comparing", async () => {
    const summary = await asApp({ userId: "u-a", businessId: A }, (tx) => runSourcing(tx, ctxA, R1, provider));
    expect(summary).toMatchObject({ suppliersFound: 3, quotationsCreated: 3, quotationsSkipped: 0, requestStatus: "comparing" });

    const { rows } = await pg.query<{ status: string }>(`select status from procurement_requests where id='${R1}'`);
    expect(rows[0]!.status).toBe("comparing");
  });

  it("stores demo data as demo, with payout destinations only proposed", async () => {
    const { rows } = await pg.query<{ source_type: string; status: string }>(
      `select s.source_type, d.status from suppliers s join supplier_payout_destinations d on d.supplier_id = s.id where s.business_id='${A}'`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source_type === "demo" && r.status === "pending")).toBe(true);
  });

  it("is idempotent: re-running updates suppliers and skips quotes already stored", async () => {
    const again = await asApp({ userId: "u-a", businessId: A }, (tx) => runSourcing(tx, ctxA, R1, provider));
    expect(again).toMatchObject({ suppliersFound: 3, quotationsCreated: 0, quotationsSkipped: 3 });
    const { rows } = await pg.query<{ n: string }>(`select count(*)::text n from suppliers where business_id='${A}'`);
    expect(rows[0]!.n).toBe("3");
  });

  it("refuses to source a request that has already moved on", async () => {
    await newRequest("10000000-0000-4000-8000-0000000000ff", "PR-9099", "approved");
    await expectServiceError(
      asApp({ userId: "u-a", businessId: A }, (tx) => runSourcing(tx, ctxA, "10000000-0000-4000-8000-0000000000ff", provider)),
      "INVALID_STATE",
    );
  });

  it("another business cannot see or source this request", async () => {
    await expectServiceError(
      asApp({ userId: "u-b", businessId: B }, (tx) => runSourcing(tx, { businessId: B, userId: "u-b", now: NOW }, R1, provider)),
      "NOT_FOUND",
    );
    const leaked = await asApp({ userId: "u-b", businessId: B }, (tx) => tx.select().from(schema.suppliers));
    expect(leaked).toHaveLength(0);
  });
});

describe("comparison", () => {
  it("recommends Meridian, ranks Atlas second and leaves PrimeHarvest for review", async () => {
    const { comparison, suppliers } = await asApp({ userId: "u-a", businessId: A }, (tx) => loadComparison(tx, ctxA, R1));
    const name = (id: string) => suppliers.find((s) => s.id === id)!.name;
    expect(comparison.rows.map((r) => [name(r.supplierId), r.verdict, r.rank, r.totalCost])).toEqual([
      ["Meridian Wholesale", "eligible", 1, "1630.000000"],
      ["Atlas Food Distribution", "eligible", 2, "1730.000000"],
      ["PrimeHarvest Supplies", "review_required", null, "1725.000000"],
    ]);
    expect(comparison.estimatedSavings?.amount).toBe("100.00");
    expect(suppliers.every((s) => s.sourceType === "demo")).toBe(true);
  });
});

describe("purchase order and approval", () => {
  let meridianQuote: string;
  let primeQuote: string;
  let orderId: string;

  beforeAll(async () => {
    const { comparison, suppliers } = await asApp({ userId: "u-a", businessId: A }, (tx) => loadComparison(tx, ctxA, R1));
    const q = (n: string) => comparison.rows.find((r) => suppliers.find((s) => s.id === r.supplierId)!.name === n)!.quoteId;
    meridianQuote = q("Meridian Wholesale");
    primeQuote = q("PrimeHarvest Supplies");
  });

  it("refuses a quote that needs review unless a person acknowledges it", async () => {
    const e = await expectServiceError(
      asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R1, quotationId: primeQuote, conversion: CONVERSION })),
      "REVIEW_REQUIRED",
    );
    expect((e.details as { missingEvidence: string[] }).missingEvidence).toEqual(expect.arrayContaining(["contact_information", "payment_destination"]));
  });

  it("refuses a total supplied by the caller that differs from the calculated one", async () => {
    await expectServiceError(
      asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R1, quotationId: meridianQuote, claimedTotal: "1.00", conversion: CONVERSION })),
      "CLAIMED_TOTAL_MISMATCH",
    );
  });

  it("refuses to mix currencies without an explicit rate", async () => {
    await expectServiceError(
      asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R1, quotationId: meridianQuote })),
      "PAYMENT_CONVERSION_REQUIRED",
    );
  });

  it("creates a purchase order from the recommended quote with server-calculated totals", async () => {
    const res = await asApp({ userId: "u-a", businessId: A }, (tx) =>
      createPurchaseOrder(tx, ctxA, { requestId: R1, quotationId: meridianQuote, claimedTotal: "1630.00", conversion: CONVERSION }));
    orderId = res.order.id;
    expect(res.order).toMatchObject({ orderNumber: "PO-0001", status: "pending_approval", totalAmount: "1630.000000", paymentAsset: "USDC.e", paymentAmount: "1630.000000" });
    expect(res.lines.map((l) => l.totalPrice)).toEqual(["1150.00", "290.00", "140.00"]);
    expect(res.policy.requiresApproval).toBe(true);

    const { rows } = await pg.query<{ rs: string; qs: string; ap: string }>(`
      select (select status from procurement_requests where id='${R1}') rs,
             (select quote_status from quotations where id='${meridianQuote}') qs,
             (select status from approvals where purchase_order_id='${orderId}') ap`);
    expect(rows[0]).toEqual({ rs: "awaiting_approval", qs: "selected", ap: "pending" });
  });

  it("will not create a second open order for the same request", async () => {
    await expectServiceError(
      asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R1, quotationId: meridianQuote, conversion: CONVERSION })),
      "INVALID_STATE", // request is no longer "comparing"
    );
  });

  it("cannot approve while the supplier's payment address is unapproved", async () => {
    await expectServiceError(asApp({ userId: "u-a", businessId: A }, (tx) => approveOrder(tx, ctxA, orderId)), "RECIPIENT_NOT_APPROVED");
  });

  it("approves the order once a person approves the payout address, and records a fingerprint", async () => {
    const { rows } = await pg.query<{ id: string }>(`
      select d.id from supplier_payout_destinations d join suppliers s on s.id=d.supplier_id where s.name='Meridian Wholesale'`);
    const dest = await asApp({ userId: "u-a", businessId: A }, (tx) => approvePayoutDestination(tx, ctxA, rows[0]!.id));
    expect(dest.status).toBe("approved");
    expect(dest.approvedBy).toBe("u-a");

    const approval = await asApp({ userId: "u-a", businessId: A }, (tx) => approveOrder(tx, ctxA, orderId));
    expect(approval.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(approval.recipientAddress).toBe("0xDe30000000000000000000000000000000000002");

    const { rows: po } = await pg.query<{ status: string; approved_fingerprint: string; approved_by: string; rs: string }>(`
      select po.status, po.approved_fingerprint, po.approved_by,
             (select status from procurement_requests where id='${R1}') rs
      from purchase_orders po where po.id='${orderId}'`);
    expect(po[0]).toMatchObject({ status: "approved", approved_fingerprint: approval.fingerprint, approved_by: "u-a", rs: "approved" });
  });

  it("cannot approve the same order twice", async () => {
    await expectServiceError(asApp({ userId: "u-a", businessId: A }, (tx) => approveOrder(tx, ctxA, orderId)), "INVALID_STATE");
  });

  it("detects tampering: changing an item after approval changes the fingerprint", async () => {
    const before = await asApp({ userId: "u-a", businessId: A }, async (tx) => {
      const [po] = await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, orderId));
      return fingerprintFor(tx, po!, "0xDe30000000000000000000000000000000000002");
    });
    const { rows } = await pg.query<{ approved_fingerprint: string }>(`select approved_fingerprint from purchase_orders where id='${orderId}'`);
    expect(before).toBe(rows[0]!.approved_fingerprint); // untouched: matches

    await pg.exec(`update purchase_order_items set unit_price = 1.00 where purchase_order_id='${orderId}' and description='Vegetable oil'`);
    const after = await asApp({ userId: "u-a", businessId: A }, async (tx) => {
      const [po] = await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, orderId));
      return fingerprintFor(tx, po!, "0xDe30000000000000000000000000000000000002");
    });
    expect(after).not.toBe(rows[0]!.approved_fingerprint);
  });

  it("an attacker-swapped recipient also changes the fingerprint", async () => {
    const swapped = await asApp({ userId: "u-a", businessId: A }, async (tx) => {
      const [po] = await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, orderId));
      return fingerprintFor(tx, po!, "0xBAD0000000000000000000000000000000000001");
    });
    const { rows } = await pg.query<{ approved_fingerprint: string }>(`select approved_fingerprint from purchase_orders where id='${orderId}'`);
    expect(swapped).not.toBe(rows[0]!.approved_fingerprint);
  });

  it("wrote an audit trail for every step", async () => {
    const { rows } = await pg.query<{ action: string }>(`select action from audit_logs where business_id='${A}' order by created_at`);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining([
      "procurement.sourced", "order.created", "supplier.payout_destination.approved", "order.approved",
    ]));
  });
});

describe("policy and rejection", () => {
  const provider = new DemoSupplierProvider();
  let quoteId: string;

  beforeAll(async () => {
    await asApp({ userId: "u-a", businessId: A }, (tx) => runSourcing(tx, ctxA, R2, provider));
    const { comparison } = await asApp({ userId: "u-a", businessId: A }, (tx) => loadComparison(tx, ctxA, R2));
    quoteId = comparison.recommendedQuoteId!;
  });

  it("rejects an order that exceeds the per-transaction limit, with reason codes", async () => {
    await pg.exec(`update spending_policies set max_transaction_amount = 1000 where business_id='${A}'`);
    try {
      const e = await expectServiceError(
        asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R2, quotationId: quoteId, conversion: CONVERSION })),
        "POLICY_REJECTED",
      );
      expect((e.details as { reasonCodes: string[] }).reasonCodes).toContain("EXCEEDS_TRANSACTION_LIMIT");
    } finally {
      await pg.exec(`update spending_policies set max_transaction_amount = 2500 where business_id='${A}'`);
    }
  });

  it("rejecting an order cancels it and reopens the comparison", async () => {
    const res = await asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R2, quotationId: quoteId, conversion: CONVERSION }));
    await asApp({ userId: "u-a", businessId: A }, (tx) => rejectOrder(tx, ctxA, res.order.id, "Prefer another supplier"));

    const { rows } = await pg.query<{ po: string; rs: string; qs: string; ap: string }>(`
      select (select status from purchase_orders where id='${res.order.id}') po,
             (select status from procurement_requests where id='${R2}') rs,
             (select quote_status from quotations where id='${quoteId}') qs,
             (select status from approvals where purchase_order_id='${res.order.id}') ap`);
    expect(rows[0]).toEqual({ po: "cancelled", rs: "comparing", qs: "received", ap: "rejected" });
  });

  it("asks the server-side resolver for a rate and refuses when it supplies none", async () => {
    await expectServiceError(
      asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R2, quotationId: quoteId, resolveConversion: () => undefined })),
      "PAYMENT_CONVERSION_REQUIRED",
    );
    let askedFor = "";
    const res = await asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, {
      requestId: R2, quotationId: quoteId,
      resolveConversion: (currency) => { askedFor = currency; return CONVERSION; },
    }));
    expect(askedFor).toBe("USD"); // the request's currency, discovered by the service
    await asApp({ userId: "u-a", businessId: A }, (tx) => rejectOrder(tx, ctxA, res.order.id));
  });

  it("allows a fresh order after a rejection", async () => {
    const res = await asApp({ userId: "u-a", businessId: A }, (tx) => createPurchaseOrder(tx, ctxA, { requestId: R2, quotationId: quoteId, conversion: CONVERSION }));
    expect(res.order.status).toBe("pending_approval");
  });

  it("an acknowledged review-required quote can be ordered, and the acknowledgement is audited", async () => {
    await asApp({ userId: "u-a", businessId: A }, (tx) => runSourcing(tx, ctxA, R3, provider));
    const { comparison, suppliers } = await asApp({ userId: "u-a", businessId: A }, (tx) => loadComparison(tx, ctxA, R3));
    const prime = comparison.rows.find((r) => suppliers.find((s) => s.id === r.supplierId)!.name === "PrimeHarvest Supplies")!;
    const res = await asApp({ userId: "u-a", businessId: A }, (tx) =>
      createPurchaseOrder(tx, ctxA, { requestId: R3, quotationId: prime.quoteId, conversion: CONVERSION, acknowledgeReview: true }));
    expect(res.order.totalAmount).toBe("1725.000000");
    const { rows } = await pg.query<{ metadata: { acknowledgedReview: boolean; verdict: string } }>(
      `select metadata from audit_logs where resource_id='${res.order.id}' and action='order.created'`);
    expect(rows[0]!.metadata).toMatchObject({ acknowledgedReview: true, verdict: "review_required" });
  });
});
