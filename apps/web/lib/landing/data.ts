import { orderFingerprint } from "@procura/policies";
import {
  buildPurchaseOrder, compareQuotations, DemoSupplierProvider, evaluateEligibility, summariseEvidence,
  type Quote, type Requirement,
} from "@procura/procurement/core";
import { add, money, multiply, PAYMENT_ASSET, sum, type SupplierEvidenceSummary } from "@procura/shared";

/** Everything the landing page shows, produced by the real engine. Nothing here is typed in by hand. */
export interface LandingSupplier {
  id: string;
  name: string;
  total: string;
  delivery: string;
  days: number | null;
  verdict: "eligible" | "review_required" | "ineligible";
  rank: number | null;
  evidence: { identity: boolean | null; contact: boolean | null; payment: boolean | null; history: boolean };
  reasons: string[];
  address: string;
}

export interface LandingData {
  request: { number: string; items: { name: string; quantity: string; unit: string }[]; budget: string; currency: string };
  suppliers: LandingSupplier[];
  recommendedId: string;
  savings: string;
  order: {
    number: string; subtotal: string; delivery: string; total: string; fingerprint: string; recipient: string;
    lines: { description: string; quantity: string; unitPrice: string; totalPrice: string }[];
  };
  session: { budget: string; perTransaction: string; minutes: number };
  /** The inputs the in-browser playground starts from, so it matches the story exactly. */
  seed: { evidence: Record<string, SupplierEvidenceSummary>; quotes: Quote[]; requirement: Requirement };
}

const ITEMS = [
  { name: "Premium basmati rice", quantity: "50", unit: "bags" },
  { name: "Vegetable oil", quantity: "20", unit: "cartons" },
  { name: "Frozen chicken", quantity: "10", unit: "cartons" },
];

export async function buildLandingData(): Promise<LandingData> {
  const now = new Date();
  const provider = new DemoSupplierProvider();
  const found = await provider.searchSuppliers({ items: ITEMS.map((i) => ({ name: i.name, quantity: i.quantity })) });

  const requirement: Requirement = {
    currency: "USD", budget: "2000.00", maxDeliveryDays: null,
    items: ITEMS.map((i, n) => ({ id: `i${n}`, name: i.name, quantity: i.quantity })),
  };

  const quotes: Quote[] = [];
  const evidence = new Map<string, SupplierEvidenceSummary>();
  const meta = new Map<string, { name: string; address: string }>();
  for (const s of found) {
    meta.set(s.externalRef, { name: s.name, address: s.payoutDestination?.address ?? "" });
    evidence.set(s.externalRef, summariseEvidence(
      s.evidence.map((e) => ({ evidenceType: e.evidenceType, verificationStatus: e.verificationStatus, expiresAt: null })), now));
    for (const q of await provider.getQuotations!(s.externalRef, { currency: "USD", items: ITEMS.map((i) => ({ name: i.name, quantity: i.quantity })) })) {
      const subtotal = sum(q.lines.map((l) => multiply(money(l.unitPrice, q.currency), l.quantity)), q.currency);
      const delivery = money(q.deliveryCost, q.currency);
      quotes.push({
        id: `q-${s.externalRef}`, supplierId: s.externalRef, currency: q.currency, lines: q.lines,
        subtotal: subtotal.amount, deliveryCost: delivery.amount, additionalCosts: "0.00",
        totalCost: add(subtotal, delivery).amount, unknownCosts: [], estimatedDeliveryDays: q.estimatedDeliveryDays,
        availability: q.availability, status: "received", validUntil: new Date(now.getTime() + 7 * 86_400_000),
      });
    }
  }

  const eligibilities = quotes.map((q) =>
    evaluateEligibility(q, requirement, { supplierId: q.supplierId, restricted: false, evidence: evidence.get(q.supplierId)! }, now));
  const comparison = compareQuotations({ currency: "USD", quotes, eligibilities, evidenceBySupplier: evidence, priorities: ["price"] });
  const rec = comparison.rows.find((r) => r.quoteId === comparison.recommendedQuoteId);
  if (!rec) throw new Error("Landing data: the demo scenario produced no recommendation");

  const recQuote = quotes.find((q) => q.id === rec.quoteId)!;
  const po = buildPurchaseOrder({
    supplierId: recQuote.supplierId, quote: recQuote, items: requirement.items, currency: "USD", budget: "2000.00",
    paymentAsset: PAYMENT_ASSET, conversion: { rate: "1.000000", asOf: now, source: "fixed 1:1 demo peg" }, now,
  });
  const recipient = meta.get(recQuote.supplierId)!.address;
  const fingerprint = orderFingerprint({
    supplierId: recQuote.supplierId, currency: po.currency, paymentAsset: po.paymentAsset, recipientAddress: recipient,
    subtotal: po.subtotal, deliveryCost: po.deliveryCost, totalAmount: po.totalAmount,
    items: po.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.totalPrice })),
  });

  const suppliers: LandingSupplier[] = comparison.rows.map((r) => {
    const q = quotes.find((x) => x.id === r.quoteId)!;
    const e = evidence.get(q.supplierId)!;
    return {
      id: q.supplierId, name: meta.get(q.supplierId)!.name, total: q.totalCost, delivery: q.deliveryCost, days: q.estimatedDeliveryDays,
      verdict: r.verdict, rank: r.rank,
      evidence: { identity: e.identityVerified, contact: e.contactVerified, payment: e.paymentDestinationMatched, history: e.historicalPerformanceAvailable },
      reasons: r.eligibility.reasons, address: meta.get(q.supplierId)!.address,
    };
  });

  return {
    request: { number: "PR-0142", items: ITEMS, budget: "2000.00", currency: "USD" },
    suppliers,
    recommendedId: recQuote.supplierId,
    savings: comparison.estimatedSavings?.amount ?? "0.00",
    order: {
      number: "PO-2041", subtotal: po.subtotal, delivery: po.deliveryCost, total: po.totalAmount, fingerprint, recipient,
      lines: po.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.totalPrice })),
    },
    session: { budget: "2000.00", perTransaction: "2500.00", minutes: 30 },
    seed: { evidence: Object.fromEntries(evidence), quotes, requirement },
  };
}
