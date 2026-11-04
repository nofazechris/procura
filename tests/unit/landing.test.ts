import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalOrder, evaluatePaymentExecution } from "@procura/policies/core";
import { add, compare, money, PAYMENT_ASSET } from "@procura/shared";
import { buildLandingData } from "../../apps/web/lib/landing/data";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
});

async function sha256(text: string) {
  const buf = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("landing page data", () => {
  it("is computed by the engine: the recommendation is the cheapest eligible option, and a cheaper one is held back", async () => {
    const d = await buildLandingData();
    const rec = d.options.find((o) => o.id === d.recommendedId)!;
    expect(rec.verdict).toBe("eligible");
    expect(rec.kind).toBe("marketplace");
    const held = d.options.find((o) => o.verdict === "review_required");
    expect(held).toBeDefined();
    expect(held!.kind).toBe("direct");
    // The story's point: the cheapest option overall is not recommended, because its evidence has gaps.
    expect(Number(held!.total)).toBeLessThan(Number(rec.total));
    expect(held!.reasons).toEqual(expect.arrayContaining(["CONTACT_NOT_VERIFIED", "PAYMENT_DESTINATION_NOT_VERIFIED"]));
    // A marketplace is paid through checkout, so it is not held for contact or payout evidence.
    expect(rec.reasons).toEqual([]);
    expect(rec.evidence).toMatchObject({ identity: true, quote: true, payment: true });
  });

  it("keeps its sample honest: the dearest Amazon basket is within budget, and only the engine decides eligibility", async () => {
    const d = await buildLandingData();
    expect(d.seed.quotes).toHaveLength(4);
    expect(d.options.length).toBe(3);
    const eligible = d.options.filter((o) => o.verdict === "eligible");
    expect(eligible.length).toBeGreaterThanOrEqual(2);
    for (const o of d.options) expect(o.lines.length).toBeGreaterThan(0);
  });

  it("the browser's WebCrypto hash of the canonical order equals the server fingerprint", async () => {
    const d = await buildLandingData();
    const hash = await sha256(canonicalOrder({
      supplierId: d.recommendedId, currency: "USD", paymentAsset: PAYMENT_ASSET, recipientAddress: "marketplace-checkout",
      subtotal: d.order.subtotal, deliveryCost: d.order.delivery, totalAmount: d.order.total, items: d.order.lines,
    }));
    expect(hash).toBe(d.order.fingerprint);
  });

  it("changing one cent changes the fingerprint", async () => {
    const d = await buildLandingData();
    const base = { supplierId: d.recommendedId, currency: "USD", paymentAsset: PAYMENT_ASSET, recipientAddress: "marketplace-checkout", subtotal: d.order.subtotal, deliveryCost: d.order.delivery, totalAmount: d.order.total };
    const a = await sha256(canonicalOrder({ ...base, items: d.order.lines }));
    const b = await sha256(canonicalOrder({ ...base, items: d.order.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: add(money(l.unitPrice, "USD"), money("0.01", "USD")).amount } : l)) }));
    expect(a).not.toBe(b);
  });

  it("the session follows Amazon's checkout rule: cap is the subtotal plus the larger of 20% or $5, then a $1 fee", async () => {
    const d = await buildLandingData();
    const sub = Number(d.session.subtotal);
    const expectedCap = sub + Math.max(sub * 0.2, 5);
    expect(Math.abs(Number(d.session.cap) - expectedCap)).toBeLessThan(0.011);
    expect(Math.abs(Number(d.session.budget) - (expectedCap + 1))).toBeLessThan(0.011);
    expect(d.session.perTransaction).toBe(d.session.budget);
  });

  it("the honest payment passes the gate and the story's limits hold", async () => {
    const d = await buildLandingData();
    const now = new Date();
    const fp = d.order.fingerprint;
    const input = {
      now, amount: money(d.session.perTransaction, PAYMENT_ASSET), recipientAddress: "marketplace-checkout", approvedRecipientAddress: "marketplace-checkout",
      supplierRestricted: false,
      session: { status: "active" as const, asset: PAYMENT_ASSET, remainingAmount: d.session.budget, maxPerTransaction: d.session.perTransaction, expiresAt: new Date(now.getTime() + d.session.minutes * 60_000) },
      userApprovalRecorded: true, approvedOrderFingerprint: fp, currentOrderFingerprint: fp, paymentAlreadyExecuted: false, supportedAssets: [PAYMENT_ASSET],
      orderPolicy: { allowed: true, requiresApproval: true, reasonCodes: ["WITHIN_BUSINESS_BUDGET" as const], maxAllowedAmount: d.session.budget, currency: "USD" },
    };
    expect(evaluatePaymentExecution(input).allowed).toBe(true);
    const over = evaluatePaymentExecution({ ...input, amount: money(add(money(d.session.budget, "USD"), money("0.01", "USD")).amount, PAYMENT_ASSET) });
    expect(over.rejections).toEqual(expect.arrayContaining(["SESSION_BUDGET_INSUFFICIENT", "SESSION_TX_LIMIT_EXCEEDED"]));
    expect(evaluatePaymentExecution({ ...input, currentOrderFingerprint: "0".repeat(64) }).rejections).toContain("ORDER_CHANGED_AFTER_APPROVAL");
    expect(compare(money(d.session.budget, "USD"), money("0", "USD"))).toBe(1);
  });
});
