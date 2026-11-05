import { amazonCheckoutLimits, orderFingerprint } from "@procura/policies";
import {
  buildPurchaseOrder, compareQuotations, evaluateEligibility, type BasketListing, type PaymentRoute, type Quote, type Requirement,
} from "@procura/procurement/core";
import { add, compare, money, multiply, PAYMENT_ASSET, sum, toUnits, type SupplierEvidenceSummary } from "@procura/shared";
import { AmazonShopProvider } from "../server/shop-provider";

/**
 * Everything the landing page shows, produced by the real engine from a fictional sample scenario:
 * a shop buying a label printer, a charger and label rolls. The Amazon options go through the same
 * basket rules the live app uses (on a fixed sample catalogue instead of a live search), a cheaper
 * local supplier has gaps in its evidence, and the comparison, order fingerprint and session cap
 * are computed, not typed in.
 */

export interface LandingLine { item: string; short: string; quantity: string; title: string; price: string; rating: number | null; reviews: number | null }

export interface LandingOption {
  id: string;
  name: string;
  kind: "marketplace" | "direct";
  total: string;
  days: number | null;
  verdict: "eligible" | "review_required" | "ineligible";
  rank: number | null;
  lines: LandingLine[];
  /** payment: true only when a payout address was matched; a marketplace is paid through checkout instead. */
  evidence: { identity: boolean | null; quote: boolean; payment: boolean | null };
  reasons: string[];
  note: string;
}

export interface LandingData {
  request: { number: string; items: { name: string; quantity: string; unit: string }[]; budget: string; currency: string };
  /** The three options the story follows: the recommendation, a runner-up, and one held for review. */
  options: LandingOption[];
  recommendedId: string;
  savings: string;
  order: { number: string; subtotal: string; delivery: string; total: string; fingerprint: string; lines: { description: string; quantity: string; unitPrice: string; totalPrice: string }[] };
  /** Amazon's checkout charges a cap up front and refunds what the order did not use. */
  session: { budget: string; perTransaction: string; minutes: number; subtotal: string; cap: string };
  /** What the interactive sections start from, so they match the story exactly. */
  seed: {
    requirement: Requirement;
    quotes: Quote[];
    evidence: Record<string, SupplierEvidenceSummary>;
    routes: Record<string, PaymentRoute>;
    names: Record<string, string>;
    listings: Record<string, BasketListing[]>;
    lines: Record<string, LandingLine[]>;
  };
}

const L = (id: string, title: string, price: string, rating: number, reviews: number): BasketListing =>
  ({ id, title, price, rating, reviews, link: `https://www.amazon.com/dp/${id}` });

/** A fixed, fictional catalogue shaped like real search results. Labelled as a sample wherever it shows. */
export const SAMPLE_CATALOGUE: Record<string, BasketListing[]> = {
  "65W USB-C laptop charger": [
    L("B0SAMPLE01", "Universal 65W USB-C Laptop Charger", "9.99", 4.2, 3200),
    L("B0SAMPLE02", "65W GaN USB-C Charger, 3-Port", "24.99", 4.7, 1840),
    L("B0SAMPLE03", "Nano 65W USB-C Fast Charger", "34.99", 4.8, 640),
    L("B0SAMPLE04", "USB-C Charger 65W Foldable Plug", "15.99", 4.4, 910),
  ],
  "Thermal label printer": [
    L("B0SAMPLE05", "Shipping Label Printer, 4x6, USB", "36.99", 4.2, 895),
    L("B0SAMPLE06", "Bluetooth Thermal Label Printer 4x6", "39.99", 4.3, 645),
    L("B0SAMPLE07", "Pro Thermal Label Printer, 300dpi", "56.54", 4.4, 2200),
    L("B0SAMPLE08", "Compact Label Maker Printer", "44.99", 4.5, 410),
  ],
  "Thermal label rolls (500)": [
    L("B0SAMPLE09", "4x6 Direct Thermal Labels, 500 ct", "14.99", 4.6, 5200),
    L("B0SAMPLE10", "4x6 Thermal Labels, 1000 ct", "24.99", 4.5, 3100),
    L("B0SAMPLE11", "Premium 4x6 Labels, 500 ct", "18.99", 4.8, 1900),
  ],
};

const ITEMS = [
  { name: "65W USB-C laptop charger", short: "Charger", quantity: "1", unit: "unit" },
  { name: "Thermal label printer", short: "Printer", quantity: "1", unit: "unit" },
  { name: "Thermal label rolls (500)", short: "Label rolls", quantity: "2", unit: "packs" },
];
const shortOf = (name: string) => ITEMS.find((i) => i.name === name)?.short ?? name;

/** "59.656000" becomes "59.66": rounded half up to cents in integers, never through a float. */
function cents(amount: string): string {
  const units = toUnits(amount);
  const c = (units + 5000n) / 10000n;
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

const DAY = 86_400_000;

export async function buildLandingData(): Promise<LandingData> {
  const now = new Date();
  const requirement: Requirement = {
    currency: "USD", budget: "120.00", maxDeliveryDays: null,
    items: ITEMS.map((i, n) => ({ id: `i${n}`, name: i.name, quantity: i.quantity })),
  };

  // Amazon: the real provider and basket rules, on the sample catalogue.
  const shop = new AmazonShopProvider(async (q) => SAMPLE_CATALOGUE[q] ?? []);
  const found = await shop.searchSuppliers({ items: ITEMS.map((i) => ({ name: i.name, quantity: i.quantity })) });

  const quotes: Quote[] = [];
  const evidence = new Map<string, SupplierEvidenceSummary>();
  const routes: Record<string, PaymentRoute> = {};
  const names: Record<string, string> = {};
  const lines: Record<string, LandingLine[]> = {};
  const kindOf: Record<string, "marketplace" | "direct"> = {};

  for (const f of found) {
    for (const q of await shop.getQuotations(f.externalRef, { currency: "USD", items: ITEMS.map((i) => ({ name: i.name, quantity: i.quantity })) })) {
      const subtotal = sum(q.lines.map((l) => multiply(money(l.unitPrice, "USD"), l.quantity)), "USD");
      const id = `q-${f.externalRef}`;
      quotes.push({
        id, supplierId: f.externalRef, currency: "USD", lines: q.lines.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
        subtotal: subtotal.amount, deliveryCost: "0.00", additionalCosts: "0.00", totalCost: subtotal.amount, unknownCosts: q.unknownCosts,
        estimatedDeliveryDays: null, availability: "available", status: "received", validUntil: new Date(now.getTime() + DAY),
      });
      evidence.set(f.externalRef, { identityVerified: true, contactVerified: null, quotationReceived: true, paymentDestinationMatched: null, historicalPerformanceAvailable: false, unresolvedConcerns: [] });
      routes[f.externalRef] = "marketplace_checkout";
      names[f.externalRef] = f.name;
      kindOf[f.externalRef] = "marketplace";
      lines[id] = q.lines.map((l) => ({ item: l.description, short: shortOf(l.description), quantity: l.quantity, title: l.listing?.title ?? l.description, price: l.unitPrice, rating: l.listing?.rating ?? null, reviews: l.listing?.reviews ?? null }));
    }
  }

  // A local supplier: the cheapest on paper, but its contact and payout address are not verified.
  const direct = { id: "local-ikeja", name: "Ikeja Office Supply" };
  const dLines = [
    { description: ITEMS[0]!.name, quantity: "1", unitPrice: "18.00" },
    { description: ITEMS[1]!.name, quantity: "1", unitPrice: "32.00" },
    { description: ITEMS[2]!.name, quantity: "2", unitPrice: "10.50" },
  ];
  const dSub = sum(dLines.map((l) => multiply(money(l.unitPrice, "USD"), l.quantity)), "USD");
  quotes.push({
    id: `q-${direct.id}`, supplierId: direct.id, currency: "USD", lines: dLines, subtotal: dSub.amount, deliveryCost: "3.00", additionalCosts: "0.00",
    totalCost: add(dSub, money("3.00", "USD")).amount, unknownCosts: [], estimatedDeliveryDays: 2, availability: "available", status: "received", validUntil: new Date(now.getTime() + 7 * DAY),
  });
  evidence.set(direct.id, { identityVerified: true, contactVerified: null, quotationReceived: true, paymentDestinationMatched: null, historicalPerformanceAvailable: false, unresolvedConcerns: [] });
  routes[direct.id] = "supplier_payout";
  names[direct.id] = direct.name;
  kindOf[direct.id] = "direct";
  lines[`q-${direct.id}`] = dLines.map((l) => ({ item: l.description, short: shortOf(l.description), quantity: l.quantity, title: l.description, price: l.unitPrice, rating: null, reviews: null }));

  const eligibilities = quotes.map((q) =>
    evaluateEligibility(q, requirement, { supplierId: q.supplierId, restricted: false, evidence: evidence.get(q.supplierId)!, paymentRoute: routes[q.supplierId]! }, now));
  const comparison = compareQuotations({ currency: "USD", quotes, eligibilities, evidenceBySupplier: evidence, priorities: ["price"] });
  const rec = comparison.rows.find((r) => r.quoteId === comparison.recommendedQuoteId);
  if (!rec) throw new Error("Landing data: the sample scenario produced no recommendation");

  const toOption = (r: (typeof comparison.rows)[number]): LandingOption => {
    const q = quotes.find((x) => x.id === r.quoteId)!, e = evidence.get(q.supplierId)!, k = kindOf[q.supplierId]!;
    return {
      id: q.supplierId, name: names[q.supplierId]!, kind: k, total: q.totalCost, days: q.estimatedDeliveryDays, verdict: r.verdict, rank: r.rank,
      lines: lines[q.id]!, reasons: r.eligibility.reasons,
      evidence: { identity: e.identityVerified, quote: e.quotationReceived, payment: k === "marketplace" ? true : e.paymentDestinationMatched },
      note: k === "marketplace" ? "shipping and tax added at checkout" : q.estimatedDeliveryDays ? `delivery in ${q.estimatedDeliveryDays} days` : "delivery not stated",
    };
  };

  // The story follows three: the recommendation, the best eligible runner-up, and one held for review.
  const eligible = comparison.rows.filter((r) => r.verdict === "eligible" && r.quoteId !== rec.quoteId).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const held = comparison.rows.find((r) => r.verdict === "review_required");
  const story = [rec, eligible[0], held].filter((r): r is NonNullable<typeof r> => !!r).map(toOption);

  const recQuote = quotes.find((q) => q.id === rec.quoteId)!;
  const po = buildPurchaseOrder({
    supplierId: recQuote.supplierId, quote: recQuote, items: requirement.items, currency: "USD", budget: requirement.budget,
    paymentAsset: PAYMENT_ASSET, conversion: { rate: "1.000000", asOf: now, source: "USD checkout" }, now,
  });
  const fingerprint = orderFingerprint({
    supplierId: recQuote.supplierId, currency: po.currency, paymentAsset: po.paymentAsset, recipientAddress: "marketplace-checkout",
    subtotal: po.subtotal, deliveryCost: po.deliveryCost, totalAmount: po.totalAmount,
    items: po.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.totalPrice })),
  });

  // Amazon checkout rule (shared with the real checkout): a capped hold plus a $1 fee; unused cap is refunded.
  const limits = amazonCheckoutLimits(po.subtotal);

  return {
    request: { number: "PR-0142", items: ITEMS.map(({ name, quantity, unit }) => ({ name, quantity, unit })), budget: requirement.budget, currency: "USD" },
    options: story,
    recommendedId: recQuote.supplierId,
    savings: comparison.estimatedSavings?.amount ?? "0.00",
    order: {
      number: "PO-2041", subtotal: po.subtotal, delivery: po.deliveryCost, total: po.totalAmount, fingerprint,
      lines: po.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.totalPrice })),
    },
    session: { budget: limits.charge, perTransaction: limits.charge, minutes: 30, subtotal: limits.subtotal, cap: limits.cap },
    seed: { requirement, quotes, evidence: Object.fromEntries(evidence), routes, names, listings: SAMPLE_CATALOGUE, lines },
  };
}
