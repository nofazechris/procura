"use client";

import { useMemo, useState } from "react";
import { compareQuotations, evaluateEligibility } from "@procura/procurement/core";
import type { SupplierEvidenceSummary } from "@procura/shared";
import type { LandingData } from "@/lib/landing/data";
import { usd } from "@/lib/landing/text";
import { CompareVisual, type CompareBar } from "./visuals";
import { Split } from "./split";

const DAY = 86_400_000;

export function CompareSection({ data }: { data: LandingData }) {
  const [budget, setBudget] = useState(120);
  const [verified, setVerified] = useState(false);

  const result = useMemo(() => {
    const now = new Date();
    const evidence: Record<string, SupplierEvidenceSummary> = { ...data.seed.evidence };
    if (verified) evidence["local-ikeja"] = { ...evidence["local-ikeja"]!, contactVerified: true, paymentDestinationMatched: true };
    const requirement = { ...data.seed.requirement, budget: budget.toFixed(2) };
    const quotes = data.seed.quotes.map((q) => ({ ...q, validUntil: new Date(now.getTime() + DAY) }));
    const eligibilities = quotes.map((q) => evaluateEligibility(q, requirement, { supplierId: q.supplierId, restricted: false, evidence: evidence[q.supplierId]!, paymentRoute: data.seed.routes[q.supplierId]! }, now));
    const cmp = compareQuotations({ currency: "USD", quotes, eligibilities, evidenceBySupplier: new Map(Object.entries(evidence)), priorities: ["price"] });
    const props: { budget: number; cols: CompareBar[] } = {
      budget,
      cols: quotes.map((q) => {
        const r = cmp.rows.find((x) => x.quoteId === q.id)!;
        return { id: q.supplierId, name: data.seed.names[q.supplierId]!, total: Number(q.totalCost), verdict: r.verdict, recommended: q.id === cmp.recommendedQuoteId, over: r.eligibility.reasons.includes("OVER_BUDGET") };
      }),
    };
    const rec = quotes.find((q) => q.id === cmp.recommendedQuoteId);
    return { props, cmp, recName: rec ? data.seed.names[rec.supplierId] : null };
  }, [data, budget, verified]);

  return (
    <Split
      id="compare" side="left" kicker="Try it · Compare" title="Cheapest is not the only test."
      visual={<CompareVisual {...result.props} />}
    >
      <p className="lx-body">
        The engine decides who is eligible before anything is ranked. Anything over budget is out, and anything held for review
        is never recommended, even when it is the cheapest. Change the budget, or verify the local supplier, and the real
        comparison reruns in your browser.
      </p>
      <label className="lx-slider">
        <span>Budget <b>{usd(budget)}</b></span>
        <input type="range" min={60} max={160} step={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label="Budget in dollars" />
      </label>
      <div className="lx-chips2">
        <button className={`lx-chip2 ${verified ? "ok" : "unk"}`} aria-pressed={verified} onClick={() => setVerified(!verified)}>
          {verified ? "✓" : "?"} Local supplier&apos;s contact and payout verified
        </button>
      </div>
      <div className={`lx-verdict2 ${result.recName ? "eligible" : "ineligible"}`} aria-live="polite">
        <b>{result.recName ? `Recommended: ${result.recName.replace(/^Amazon: /, "Amazon, ")}` : "Nothing eligible"}</b>
        <span>{result.recName ? (result.cmp.estimatedSavings ? `Estimated saving ${usd(result.cmp.estimatedSavings.amount)} against the dearest eligible option.` : "Only one option is eligible.") : "Raise the budget or verify a supplier."}</span>
      </div>
    </Split>
  );
}
