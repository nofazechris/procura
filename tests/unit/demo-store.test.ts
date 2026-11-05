import { beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@procura/shared";
import {
  demoApproveOrder, demoApprovePayout, demoComparison, demoCreateOrder, demoCreateRequest, demoExecutePayment,
  demoRejectOrder, demoSourcing, getDemo, resetDemo,
} from "../../apps/web/lib/demo/store";

/**
 * Demo mode runs the real eligibility, comparison and purchase-order engine on sample data.
 * These tests pin that it behaves like the live system, and that it cannot be made to "succeed"
 * by skipping a step.
 */

const REQ = "demo-req-142";

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { if (e instanceof ServiceError) return e.code; throw e; }
  return "NO_ERROR";
}

beforeEach(async () => { await resetDemo(); });

describe("demo scenario", () => {
  it("starts with the sample comparison computed by the real engine", async () => {
    const v = await demoComparison(REQ);
    const name = (id: string) => v.suppliers.find((s) => s.id === id)!.name;
    expect(v.comparison.rows.map((r) => [name(r.supplierId), r.verdict, r.rank])).toEqual([
      ["Northgate Supply", "eligible", 1], ["Harbor Electronics", "eligible", 2], ["Corner Tech Shop", "review_required", null],
    ]);
    expect(v.comparison.estimatedSavings?.amount).toBe("4.25");
  });

  it("labels every demo supplier as demo", async () => {
    const s = await getDemo();
    expect(s.suppliers.every((x) => x.sourceType === "demo")).toBe(true);
  });

  it("starts with PO-2041 waiting for approval, and the supplier address only proposed", async () => {
    const s = await getDemo();
    const po = s.orders.find((o) => o.orderNumber === "PO-2041")!;
    expect(po.status).toBe("pending_approval");
    expect(po.totalAmount).toBe("47.000000");
    expect(s.destinations.filter((d) => d.supplierId.includes("northgate"))[0]!.status).toBe("pending");
  });
});

describe("approval and payment guards", () => {
  it("cannot approve an order while the supplier address is unapproved", async () => {
    expect(await code(demoApproveOrder("demo-order-2041"))).toBe("RECIPIENT_NOT_APPROVED");
  });

  it("approves once a person approves the address", async () => {
    const s = await getDemo();
    const dest = s.destinations.find((d) => d.supplierId.includes("northgate"))!;
    await demoApprovePayout(dest.id);
    const r = await demoApproveOrder("demo-order-2041");
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(s.orders.find((o) => o.id === "demo-order-2041")!.status).toBe("approved");
  });

  it("a paid order is paid exactly once", async () => {
    const p = await demoExecutePayment("demo-order-2041");
    expect(p.status).toBe("confirmed");
    expect(p.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    const s = await getDemo();
    expect(s.orders.find((o) => o.id === "demo-order-2041")!.status).toBe("paid");
    expect(s.requests.find((r) => r.id === REQ)!.status).toBe("processing");
    expect(await code(demoExecutePayment("demo-order-2041"))).toBe("INVALID_STATE");
    expect(s.payments).toHaveLength(1);
  });

  it("an order cannot be paid after it was rejected", async () => {
    await demoRejectOrder("demo-order-2041");
    expect(await code(demoExecutePayment("demo-order-2041"))).toBe("INVALID_STATE");
    const s = await getDemo();
    expect(s.requests.find((r) => r.id === REQ)!.status).toBe("comparing");
  });
});

describe("new requests in the demo", () => {
  const items = [
    { productName: "USB-C charger", quantity: "2", unit: "pieces" },
    { productName: "Desk lamp", quantity: "1", unit: "piece" },
    { productName: "Notebook", quantity: "3", unit: "packs" },
  ];

  it("sources a new request and finds the same three suppliers", async () => {
    const r = await demoCreateRequest({ title: "Second restock", budgetAmount: "120", currency: "USD", items });
    expect(r.status).toBe("draft");
    const summary = await demoSourcing(r.id);
    expect(summary).toMatchObject({ suppliersFound: 3, quotationsCreated: 3, requestStatus: "comparing" });
    const v = await demoComparison(r.id);
    expect(v.comparison.recommendedQuoteId).not.toBeNull();
  });

  it("finds nothing for products the demo provider does not stock, rather than inventing suppliers", async () => {
    const r = await demoCreateRequest({ title: "Forklift", budgetAmount: "9000", currency: "USD", items: [{ productName: "Industrial forklift", quantity: "1", unit: "unit" }] });
    expect(await demoSourcing(r.id)).toMatchObject({ suppliersFound: 0, quotationsCreated: 0 });
    expect((await demoComparison(r.id)).comparison.rows).toHaveLength(0);
  });

  it("will not order from a quote that needs review unless acknowledged, and refuses an over-budget request", async () => {
    const r = await demoCreateRequest({ title: "Restock", budgetAmount: "120", currency: "USD", items });
    await demoSourcing(r.id);
    const v = await demoComparison(r.id);
    const review = v.comparison.rows.find((x) => x.verdict === "review_required")!;
    expect(await code(demoCreateOrder(r.id, review.quoteId, false))).toBe("REVIEW_REQUIRED");

    const tight = await demoCreateRequest({ title: "Tight", budgetAmount: "30", currency: "USD", items });
    await demoSourcing(tight.id);
    const rows = (await demoComparison(tight.id)).comparison.rows;
    expect(rows.every((x) => x.verdict === "ineligible")).toBe(true);
    expect(await code(demoCreateOrder(tight.id, rows[0]!.quoteId, true))).toBe("QUOTE_INELIGIBLE");
  });

  it("does not allow two open orders for one request", async () => {
    const s = await getDemo();
    const q = s.quotes.find((x) => x.requestId === REQ)!;
    expect(await code(demoCreateOrder(REQ, q.id, true))).toBe("ORDER_EXISTS");
  });
});
