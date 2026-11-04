import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalOrder, evaluatePaymentExecution } from "@procura/policies/core";
import { buildLandingData } from "../../apps/web/lib/landing/data";
import { money, PAYMENT_ASSET } from "@procura/shared";

async function sha256(text: string) {
  const buf = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("landing page data", () => {
  it("comes from the engine: the recommendation is the cheapest eligible quote", async () => {
    const d = await buildLandingData();
    const eligible = d.suppliers.filter((s) => s.verdict === "eligible");
    const cheapest = [...eligible].sort((a, b) => Number(a.total) - Number(b.total))[0]!;
    expect(d.recommendedId).toBe(cheapest.id);
    expect(d.suppliers.some((s) => s.verdict === "review_required")).toBe(true);
  });

  it("the browser's WebCrypto hash of the canonical order equals the server fingerprint", async () => {
    const d = await buildLandingData();
    const hash = await sha256(canonicalOrder({
      supplierId: d.recommendedId, currency: "USD", paymentAsset: PAYMENT_ASSET, recipientAddress: d.order.recipient,
      subtotal: d.order.subtotal, deliveryCost: d.order.delivery, totalAmount: d.order.total, items: d.order.lines,
    }));
    expect(hash).toBe(d.order.fingerprint);
  });

  it("changing one cent changes the fingerprint", async () => {
    const d = await buildLandingData();
    const base = { supplierId: d.recommendedId, currency: "USD", paymentAsset: PAYMENT_ASSET, recipientAddress: d.order.recipient, subtotal: d.order.subtotal, deliveryCost: d.order.delivery, totalAmount: d.order.total };
    const a = await sha256(canonicalOrder({ ...base, items: d.order.lines }));
    const b = await sha256(canonicalOrder({ ...base, items: d.order.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: `${l.unitPrice}1` } : l)) }));
    expect(a).not.toBe(b);
  });

  it("the honest payment passes the gate and the story's session limits hold", async () => {
    const d = await buildLandingData();
    const now = new Date();
    const input = {
      now, amount: money(d.order.total, PAYMENT_ASSET), recipientAddress: d.order.recipient, approvedRecipientAddress: d.order.recipient,
      supplierRestricted: false,
      session: { status: "active" as const, asset: PAYMENT_ASSET, remainingAmount: d.session.budget, maxPerTransaction: d.session.perTransaction, expiresAt: new Date(now.getTime() + d.session.minutes * 60_000) },
      userApprovalRecorded: true, approvedOrderFingerprint: d.order.fingerprint, currentOrderFingerprint: d.order.fingerprint,
      paymentAlreadyExecuted: false, supportedAssets: [PAYMENT_ASSET],
      orderPolicy: { allowed: true, requiresApproval: true, reasonCodes: ["WITHIN_BUSINESS_BUDGET" as const], maxAllowedAmount: d.session.budget, currency: "USD" },
    };
    expect(evaluatePaymentExecution(input).allowed).toBe(true);
    const over = evaluatePaymentExecution({ ...input, amount: money("2600.00", PAYMENT_ASSET) });
    expect(over.rejections).toEqual(expect.arrayContaining(["SESSION_BUDGET_INSUFFICIENT", "SESSION_TX_LIMIT_EXCEEDED"]));
    expect(evaluatePaymentExecution({ ...input, currentOrderFingerprint: "0".repeat(64) }).rejections).toContain("ORDER_CHANGED_AFTER_APPROVAL");
  });
});
