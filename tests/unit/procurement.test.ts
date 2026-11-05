import { describe, expect, it } from "vitest";
import {
  buildPurchaseOrder, compareQuotations, DemoSupplierProvider, evaluateEligibility, PurchaseOrderError,
  summariseEvidence, type Quote, type Requirement, type SupplierContext,
} from "@procura/procurement";
import type { SupplierEvidenceSummary } from "@procura/shared";

const now = new Date("2026-11-03T09:00:00Z");
const FUTURE = new Date("2026-11-10T09:00:00Z");

const requirement: Requirement = {
  currency: "USD", budget: "2000.00", maxDeliveryDays: 7,
  items: [
    { id: "i1", name: "Premium basmati rice", quantity: "50" },
    { id: "i2", name: "Vegetable oil", quantity: "20" },
    { id: "i3", name: "Frozen chicken", quantity: "10" },
  ],
};

const fullEvidence: SupplierEvidenceSummary = {
  identityVerified: true, contactVerified: true, quotationReceived: true,
  paymentDestinationMatched: true, historicalPerformanceAvailable: true, unresolvedConcerns: [],
};
const ctx = (over: Partial<SupplierEvidenceSummary> = {}, restricted = false, id = "s1"): SupplierContext => ({
  supplierId: id, restricted, evidence: { ...fullEvidence, ...over },
});

const meridian: Quote = {
  id: "q-meridian", supplierId: "s-meridian", currency: "USD",
  lines: [
    { description: "Premium basmati rice", quantity: "50", unitPrice: "23.00" },
    { description: "Vegetable oil", quantity: "20", unitPrice: "14.50" },
    { description: "Frozen chicken", quantity: "10", unitPrice: "14.00" },
  ],
  subtotal: "1580.00", deliveryCost: "50.00", additionalCosts: "0.00", totalCost: "1630.00", unknownCosts: [],
  estimatedDeliveryDays: 4, availability: "available", status: "received", validUntil: FUTURE,
};
const quote = (over: Partial<Quote> = {}): Quote => ({ ...meridian, ...over });

describe("summariseEvidence", () => {
  it("treats missing evidence as unknown, never as success", () => {
    const s = summariseEvidence([], now);
    expect(s.identityVerified).toBeNull();
    expect(s.contactVerified).toBeNull();
    expect(s.paymentDestinationMatched).toBeNull();
    expect(s.quotationReceived).toBe(false);
  });

  it("ignores expired evidence", () => {
    const s = summariseEvidence([
      { evidenceType: "business_identity", verificationStatus: "verified", expiresAt: new Date("2026-11-01T00:00:00Z") },
    ], now);
    expect(s.identityVerified).toBeNull();
  });

  it("lets a failure win over a success", () => {
    const s = summariseEvidence([
      { evidenceType: "payment_destination", verificationStatus: "verified", expiresAt: null },
      { evidenceType: "payment_destination", verificationStatus: "failed", expiresAt: null },
    ], now);
    expect(s.paymentDestinationMatched).toBe(false);
  });

  it("does not count unverified rows as verified", () => {
    const s = summariseEvidence([{ evidenceType: "business_identity", verificationStatus: "unverified", expiresAt: null }], now);
    expect(s.identityVerified).toBeNull();
  });
});

describe("evaluateEligibility", () => {
  it("accepts a clean quote with full evidence", () => {
    const e = evaluateEligibility(meridian, requirement, ctx(), now);
    expect(e.verdict).toBe("eligible");
    expect(e.reasons).toEqual([]);
  });

  it("accepts a quote lacking only delivery history, as a concern", () => {
    const e = evaluateEligibility(meridian, requirement, ctx({ historicalPerformanceAvailable: false }), now);
    expect(e.verdict).toBe("eligible");
    expect(e.concerns).toContain("No delivery history on record");
    expect(e.missingEvidence).toContain("delivery_history");
  });

  it("needs review when identity, contact or payment evidence is unknown", () => {
    const e = evaluateEligibility(meridian, requirement, ctx({ contactVerified: null, paymentDestinationMatched: null }), now);
    expect(e.verdict).toBe("review_required");
    expect(e.reasons).toEqual(expect.arrayContaining(["CONTACT_NOT_VERIFIED", "PAYMENT_DESTINATION_NOT_VERIFIED"]));
    expect(e.missingEvidence).toEqual(expect.arrayContaining(["contact_information", "payment_destination"]));
  });

  it("rejects a failed identity or a payment destination that does not match", () => {
    expect(evaluateEligibility(meridian, requirement, ctx({ identityVerified: false }), now).reasons).toContain("IDENTITY_FAILED");
    const mismatch = evaluateEligibility(meridian, requirement, ctx({ paymentDestinationMatched: false }), now);
    expect(mismatch.verdict).toBe("ineligible");
    expect(mismatch.reasons).toContain("PAYMENT_DESTINATION_MISMATCH");
  });

  it("rejects over-budget quotes by exactly one cent", () => {
    const over = quote({ totalCost: "2000.01", subtotal: "1950.01" });
    expect(evaluateEligibility(over, requirement, ctx(), now).reasons).toContain("OVER_BUDGET");
    expect(evaluateEligibility(quote({ totalCost: "2000.00", subtotal: "1950.00" }), requirement, ctx(), now).verdict).toBe("eligible");
  });

  it("never compares across currencies", () => {
    const e = evaluateEligibility(quote({ currency: "NGN", totalCost: "1000.00" }), requirement, ctx(), now);
    expect(e.verdict).toBe("ineligible");
    expect(e.reasons).toEqual(["CURRENCY_MISMATCH"]);
  });

  it("rejects expired quotes and ones that are no longer active", () => {
    expect(evaluateEligibility(quote({ validUntil: new Date("2026-11-03T09:00:00Z") }), requirement, ctx(), now).reasons).toContain("QUOTE_EXPIRED");
    expect(evaluateEligibility(quote({ status: "rejected" }), requirement, ctx(), now).reasons).toContain("QUOTE_NOT_ACTIVE");
  });

  it("rejects a quote that omits an item or under-quotes a quantity", () => {
    const missing = quote({ lines: meridian.lines.slice(0, 2) });
    const e1 = evaluateEligibility(missing, requirement, ctx(), now);
    expect(e1.reasons).toContain("MISSING_ITEMS");
    expect(e1.concerns).toContain("Not quoted: Frozen chicken");

    const short = quote({ lines: [{ ...meridian.lines[0]!, quantity: "40" }, ...meridian.lines.slice(1)] });
    expect(evaluateEligibility(short, requirement, ctx(), now).reasons).toContain("INSUFFICIENT_QUANTITY");
  });

  it("handles delivery deadlines: late is rejected, unknown needs review", () => {
    expect(evaluateEligibility(quote({ estimatedDeliveryDays: 8 }), requirement, ctx(), now).reasons).toContain("LATE_DELIVERY");
    const unknown = evaluateEligibility(quote({ estimatedDeliveryDays: null }), requirement, ctx(), now);
    expect(unknown.verdict).toBe("review_required");
    expect(unknown.reasons).toContain("DELIVERY_UNKNOWN");
    expect(evaluateEligibility(quote({ estimatedDeliveryDays: null }), { ...requirement, maxDeliveryDays: null }, ctx(), now).verdict).toBe("eligible");
  });

  it("flags unstated costs as a concern, so a low total is not mistaken for a bargain", () => {
    const e = evaluateEligibility(quote({ unknownCosts: ["delivery"] }), requirement, ctx(), now);
    expect(e.concerns.join(" ")).toMatch(/not stated/);
  });

  it("blocks restricted suppliers", () => {
    expect(evaluateEligibility(meridian, requirement, ctx({}, true), now).reasons).toContain("SUPPLIER_RESTRICTED");
  });
});

/* ------------------------------------------------------------------ */

const atlas: Quote = {
  ...meridian, id: "q-atlas", supplierId: "s-atlas",
  lines: [
    { description: "Premium basmati rice", quantity: "50", unitPrice: "24.00" },
    { description: "Vegetable oil", quantity: "20", unitPrice: "15.00" },
    { description: "Frozen chicken", quantity: "10", unitPrice: "15.00" },
  ],
  subtotal: "1650.00", deliveryCost: "80.00", totalCost: "1730.00", estimatedDeliveryDays: 5,
};
const prime: Quote = {
  ...meridian, id: "q-prime", supplierId: "s-prime",
  lines: [
    { description: "Premium basmati rice", quantity: "50", unitPrice: "24.50" },
    { description: "Vegetable oil", quantity: "20", unitPrice: "15.50" },
    { description: "Frozen chicken", quantity: "10", unitPrice: "16.50" },
  ],
  subtotal: "1700.00", deliveryCost: "25.00", totalCost: "1725.00", estimatedDeliveryDays: 3,
};

function runComparison(priority: "price" | "speed" | "reliability" | "quality" = "price") {
  const quotes = [atlas, prime, meridian];
  const evidence = new Map<string, SupplierEvidenceSummary>([
    ["s-atlas", { ...fullEvidence, historicalPerformanceAvailable: false }],
    ["s-prime", { ...fullEvidence, contactVerified: null, paymentDestinationMatched: null, historicalPerformanceAvailable: false }],
    ["s-meridian", fullEvidence],
  ]);
  const eligibilities = quotes.map((q) =>
    evaluateEligibility(q, requirement, { supplierId: q.supplierId, restricted: false, evidence: evidence.get(q.supplierId)! }, now));
  return compareQuotations({ currency: "USD", quotes, eligibilities, evidenceBySupplier: evidence, priorities: [priority] });
}

describe("compareQuotations", () => {
  it("reproduces the Northstar demo: Meridian wins, PrimeHarvest needs review", () => {
    const r = runComparison();
    expect(r.recommendedQuoteId).toBe("q-meridian");
    expect(r.rows.map((x) => [x.quoteId, x.verdict, x.rank])).toEqual([
      ["q-meridian", "eligible", 1], ["q-atlas", "eligible", 2], ["q-prime", "review_required", null],
    ]);
  });

  it("never recommends a quote that needs review, even though it is cheaper than Atlas", () => {
    const r = runComparison();
    expect(r.rows.find((x) => x.quoteId === "q-prime")!.rank).toBeNull();
    expect(r.recommendedQuoteId).not.toBe("q-prime");
  });

  it("reports estimated savings against a defined baseline, not as realised", () => {
    const r = runComparison();
    expect(r.estimatedSavings?.amount).toBe("100.00");
    expect(r.estimatedSavings?.basis).toMatch(/Estimated, not realised/);
  });

  it("computes deltas against the cheapest comparable quote", () => {
    const r = runComparison();
    expect(r.rows.find((x) => x.quoteId === "q-meridian")!.deltaVsLowest).toBe("0.00");
    expect(r.rows.find((x) => x.quoteId === "q-atlas")!.deltaVsLowest).toBe("100.00");
  });

  it("changes the order with the priority: speed prefers the faster eligible quote", () => {
    const r = runComparison("speed");
    expect(r.recommendedQuoteId).toBe("q-meridian"); // 4 days beats Atlas's 5 (Prime is not eligible)
    const reliability = runComparison("reliability");
    expect(reliability.recommendedQuoteId).toBe("q-meridian"); // full evidence beats Atlas
  });

  it("says quality cannot be ranked from quotes and falls back to price", () => {
    const r = runComparison("quality");
    expect(r.notes.join(" ")).toMatch(/Quality cannot be ranked/);
    expect(r.recommendedQuoteId).toBe("q-meridian");
  });

  it("recommends nothing when no quote is eligible, and explains why", () => {
    const evidence = new Map<string, SupplierEvidenceSummary>([["s-prime", { ...fullEvidence, contactVerified: null }]]);
    const e = evaluateEligibility(prime, requirement, { supplierId: "s-prime", restricted: false, evidence: evidence.get("s-prime")! }, now);
    const r = compareQuotations({ currency: "USD", quotes: [prime], eligibilities: [e], evidenceBySupplier: evidence, priorities: ["price"] });
    expect(r.recommendedQuoteId).toBeNull();
    expect(r.notes.join(" ")).toMatch(/will not recommend them automatically/);
    expect(r.estimatedSavings).toBeNull();
  });

  it("is deterministic regardless of input order", () => {
    const a = runComparison();
    const quotes = [meridian, prime, atlas];
    const evidence = new Map<string, SupplierEvidenceSummary>([
      ["s-atlas", { ...fullEvidence, historicalPerformanceAvailable: false }],
      ["s-prime", { ...fullEvidence, contactVerified: null, paymentDestinationMatched: null, historicalPerformanceAvailable: false }],
      ["s-meridian", fullEvidence],
    ]);
    const eligibilities = quotes.map((q) => evaluateEligibility(q, requirement, { supplierId: q.supplierId, restricted: false, evidence: evidence.get(q.supplierId)! }, now));
    const b = compareQuotations({ currency: "USD", quotes, eligibilities, evidenceBySupplier: evidence, priorities: ["price"] });
    expect(b.rows.map((r) => r.quoteId)).toEqual(a.rows.map((r) => r.quoteId));
  });
});

/* ------------------------------------------------------------------ */

const poInput = (over: Partial<Parameters<typeof buildPurchaseOrder>[0]> = {}) => ({
  supplierId: "s-meridian", quote: meridian, items: requirement.items, currency: "USD", budget: "2000.00",
  paymentAsset: "USDC.e", conversion: { rate: "1.000000", asOf: new Date("2026-11-03T08:45:00Z"), source: "fixed demo peg" }, now,
  ...over,
});
const poError = (fn: () => unknown): string => {
  try { fn(); } catch (e) { if (e instanceof PurchaseOrderError) return e.code; throw e; }
  return "NO_ERROR";
};

describe("buildPurchaseOrder", () => {
  it("recalculates every figure from unit prices", () => {
    const po = buildPurchaseOrder(poInput());
    expect(po.lines.map((l) => l.totalPrice)).toEqual(["1150.00", "290.00", "140.00"]);
    expect(po.subtotal).toBe("1580.00");
    expect(po.deliveryCost).toBe("50.00");
    expect(po.totalAmount).toBe("1630.00");
    expect(po.paymentAsset).toBe("USDC.e");
    expect(po.paymentAmount).toBe("1630.00");
    expect(po.conversionUsed?.source).toBe("fixed demo peg");
  });

  it("rejects a total claimed by the frontend or a model that differs from ours", () => {
    expect(poError(() => buildPurchaseOrder(poInput({ claimedTotal: "1500.00" })))).toBe("CLAIMED_TOTAL_MISMATCH");
    expect(() => buildPurchaseOrder(poInput({ claimedTotal: "1630.00" }))).not.toThrow();
  });

  it("rejects a supplier whose stated subtotal disagrees with its own unit prices", () => {
    expect(poError(() => buildPurchaseOrder(poInput({ quote: quote({ subtotal: "1000.00", totalCost: "1050.00" }) })))).toBe("QUOTE_INCONSISTENT");
  });

  it("rejects a quote from a different supplier, expired, rejected or in another currency", () => {
    expect(poError(() => buildPurchaseOrder(poInput({ supplierId: "someone-else" })))).toBe("SUPPLIER_MISMATCH");
    expect(poError(() => buildPurchaseOrder(poInput({ quote: quote({ validUntil: now }) })))).toBe("QUOTE_EXPIRED");
    expect(poError(() => buildPurchaseOrder(poInput({ quote: quote({ status: "rejected" }) })))).toBe("QUOTE_NOT_ACTIVE");
    expect(poError(() => buildPurchaseOrder(poInput({ currency: "NGN" })))).toBe("CURRENCY_MISMATCH");
  });

  it("rejects an order over budget", () => {
    expect(poError(() => buildPurchaseOrder(poInput({ budget: "1629.99" })))).toBe("OVER_BUDGET");
  });

  it("orders the requested quantity, and refuses when the supplier quoted less", () => {
    const short = quote({ lines: [{ ...meridian.lines[0]!, quantity: "40" }, ...meridian.lines.slice(1)] });
    expect(poError(() => buildPurchaseOrder(poInput({ quote: short })))).toBe("INSUFFICIENT_QUANTITY");
  });

  it("folds additional charges into a visible line so totals still add up", () => {
    const withFees = quote({ additionalCosts: "20.00", totalCost: "1650.00" });
    const po = buildPurchaseOrder(poInput({ quote: withFees }));
    expect(po.lines.at(-1)!.description).toMatch(/Additional charges/);
    expect(po.subtotal).toBe("1600.00");
    expect(po.totalAmount).toBe("1650.00");
  });

  it("never converts currency silently: it requires an explicit, fresh rate", () => {
    expect(poError(() => buildPurchaseOrder(poInput({ conversion: undefined })))).toBe("PAYMENT_CONVERSION_REQUIRED");
    const stale = { rate: "1.000000", asOf: new Date("2026-11-03T07:59:00Z"), source: "x" };
    expect(poError(() => buildPurchaseOrder(poInput({ conversion: stale })))).toBe("STALE_CONVERSION_RATE");
    const future = { rate: "1.000000", asOf: new Date("2026-11-03T09:05:00Z"), source: "x" };
    expect(poError(() => buildPurchaseOrder(poInput({ conversion: future })))).toBe("STALE_CONVERSION_RATE");
  });

  it("applies the supplied rate exactly", () => {
    const po = buildPurchaseOrder(poInput({ conversion: { rate: "0.999000", asOf: new Date("2026-11-03T08:50:00Z"), source: "test" } }));
    expect(po.paymentAmount).toBe("1628.37"); // 1630 x 0.999
  });
});

describe("DemoSupplierProvider", () => {
  const provider = new DemoSupplierProvider();
  const items = [
    { name: "USB-C charger", quantity: "2" },
    { name: "Desk lamp", quantity: "1" },
    { name: "Notebook", quantity: "3" },
  ];

  it("finds the three fictional suppliers, all labelled demo", async () => {
    const found = await provider.searchSuppliers({ items });
    expect(found.map((s) => s.name)).toEqual(["Harbor Electronics", "Northgate Supply", "Corner Tech Shop"]);
    expect(found.every((s) => s.sourceType === "demo")).toBe(true);
    expect(found.every((s) => s.evidence.every((e) => e.sourceName.includes("fictional")))).toBe(true);
  });

  it("returns nothing for products it does not stock rather than inventing a result", async () => {
    expect(await provider.searchSuppliers({ items: [{ name: "Industrial forklift", quantity: "1" }] })).toEqual([]);
    expect(await provider.getQuotations("demo-harbor", { currency: "USD", items: [{ name: "Industrial forklift", quantity: "1" }] })).toEqual([]);
  });

  it("marks a quote partial when only some items are stocked", async () => {
    const [q] = await provider.getQuotations("demo-harbor", { currency: "USD", items: [...items, { name: "Forklift", quantity: "1" }] });
    expect(q!.availability).toBe("partial");
    expect(q!.lines).toHaveLength(3);
  });

  it("proposes payout destinations but approves none, and honours a controlled recipient", async () => {
    const found = await new DemoSupplierProvider({ recipientOverride: "0x1111111111111111111111111111111111111111" }).searchSuppliers({ items });
    expect(found.every((s) => s.payoutDestination?.address === "0x1111111111111111111111111111111111111111")).toBe(true);
  });

  it("returns null for an unknown supplier", async () => {
    expect(await provider.getSupplierDetails("nope")).toBeNull();
  });
});
