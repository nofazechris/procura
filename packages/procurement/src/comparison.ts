import { subtract, toUnits, type SupplierEvidenceSummary } from "@procura/shared";
import { evidenceScore } from "./evidence";
import type { Eligibility, EligibilityVerdict, Priority, Quote } from "./types";

export interface ComparisonRow {
  quoteId: string;
  supplierId: string;
  verdict: EligibilityVerdict;
  totalCost: string;
  currency: string;
  deliveryDays: number | null;
  /** 1 is best. Only eligible quotes are ranked. */
  rank: number | null;
  /** Difference from the cheapest comparable quote, same currency only. */
  deltaVsLowest: string | null;
  eligibility: Eligibility;
}

export interface ComparisonResult {
  currency: string;
  rows: ComparisonRow[];
  /** Null when nothing is eligible. A model may recommend only among rows with a rank. */
  recommendedQuoteId: string | null;
  /**
   * Estimated, not realised. Baseline is the highest-priced eligible quote for the same items,
   * quantities and currency (Technical PRD s10.3). Null with fewer than two comparable quotes.
   */
  estimatedSavings: { amount: string; currency: string; basis: string } | null;
  notes: string[];
}

/** A request's comparison together with the supplier names and evidence it was based on. */
export interface ComparisonView {
  comparison: ComparisonResult;
  suppliers: { id: string; name: string; sourceType: string }[];
  evidence: Record<string, SupplierEvidenceSummary>;
}

export interface CompareInput {
  currency: string;
  quotes: Quote[];
  eligibilities: Eligibility[];
  evidenceBySupplier: Map<string, SupplierEvidenceSummary>;
  priorities: Priority[];
}

const cmpUnits = (a: string, b: string) => {
  const x = toUnits(a), y = toUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
/** Null days sort last: an unknown delivery time is never preferred over a known one. */
const cmpDays = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);

export function compareQuotations(input: CompareInput): ComparisonResult {
  const { currency, quotes, eligibilities, evidenceBySupplier } = input;
  const notes: string[] = [];
  const primary = input.priorities[0] ?? "price";
  if (primary === "quality") {
    notes.push("Quality cannot be ranked from quotations alone, so price was used for ordering.");
  }

  const byQuote = new Map(eligibilities.map((e) => [e.quoteId, e]));
  const comparable = quotes.filter((q) => q.currency === currency);
  const lowest = comparable.reduce<string | null>(
    (min, q) => (min === null || cmpUnits(q.totalCost, min) < 0 ? q.totalCost : min), null,
  );

  const entries = quotes.map((q) => {
    const eligibility = byQuote.get(q.id);
    if (!eligibility) throw new Error(`No eligibility result for quote ${q.id}`);
    const ev = evidenceBySupplier.get(q.supplierId);
    return { q, eligibility, score: ev ? evidenceScore(ev) : 0 };
  });

  const order = { eligible: 0, review_required: 1, ineligible: 2 } as const;
  entries.sort((a, b) => {
    const v = order[a.eligibility.verdict] - order[b.eligibility.verdict];
    if (v !== 0) return v;
    let c = 0;
    if (primary === "speed") c = cmpDays(a.q.estimatedDeliveryDays, b.q.estimatedDeliveryDays);
    else if (primary === "reliability") c = b.score - a.score;
    if (c === 0) c = a.q.currency === b.q.currency ? cmpUnits(a.q.totalCost, b.q.totalCost) : a.q.currency.localeCompare(b.q.currency);
    if (c === 0) c = cmpDays(a.q.estimatedDeliveryDays, b.q.estimatedDeliveryDays);
    return c !== 0 ? c : a.q.id.localeCompare(b.q.id); // fully deterministic
  });

  let rank = 0;
  const rows: ComparisonRow[] = entries.map(({ q, eligibility }) => ({
    quoteId: q.id,
    supplierId: q.supplierId,
    verdict: eligibility.verdict,
    totalCost: q.totalCost,
    currency: q.currency,
    deliveryDays: q.estimatedDeliveryDays,
    rank: eligibility.verdict === "eligible" ? ++rank : null,
    deltaVsLowest:
      q.currency === currency && lowest !== null
        ? subtract({ amount: q.totalCost, currency }, { amount: lowest, currency }).amount
        : null,
    eligibility,
  }));

  const eligibleRows = rows.filter((r) => r.rank !== null);
  const recommended = eligibleRows[0] ?? null;

  if (!recommended) {
    const needsReview = rows.some((r) => r.verdict === "review_required");
    notes.push(
      needsReview
        ? "No quote is fully eligible. Some need review because evidence is missing; Procura will not recommend them automatically."
        : "No quote meets the requirements.",
    );
  }

  let estimatedSavings: ComparisonResult["estimatedSavings"] = null;
  if (recommended && eligibleRows.length >= 2) {
    const baseline = eligibleRows.reduce((max, r) => (cmpUnits(r.totalCost, max) > 0 ? r.totalCost : max), recommended.totalCost);
    const diff = subtract({ amount: baseline, currency }, { amount: recommended.totalCost, currency });
    estimatedSavings = {
      amount: diff.amount, currency,
      basis: "Highest-priced eligible quote for the same items, quantities and currency. Estimated, not realised.",
    };
  }

  return { currency, rows, recommendedQuoteId: recommended?.quoteId ?? null, estimatedSavings, notes };
}
