import type { PlateState, ProveProps } from "./prove-types";

/* The flat (2D) visuals. Pure markup and CSS: no WebGL, and they animate through transitions. */

const WORD: Record<PlateState, string> = { verified: "verified", unknown: "unknown", na: "not needed", failed: "failed" };
const MARK: Record<PlateState, string> = { verified: "✓", unknown: "?", na: "–", failed: "×" };
const VERDICT = { eligible: "Eligible", review_required: "Held for review", ineligible: "Not eligible" } as const;

/** Evidence as a chain: each check is a row, and they all feed one verdict. */
export function ProveVisual({ plates, verdict }: ProveProps) {
  return (
    <div className={`pv ${verdict}`} role="img" aria-label={`Evidence checks leading to a verdict: ${VERDICT[verdict]}`}>
      <div className="pv-rail" aria-hidden="true" />
      {plates.map((p, i) => (
        <div key={p.id} className={`pv-row ${p.state}`} style={{ transitionDelay: `${i * 40}ms` }}>
          <span className="pv-dot">{MARK[p.state]}</span>
          <span className="pv-label">{p.label}</span>
          <span className="pv-word">{WORD[p.state]}</span>
        </div>
      ))}
      <div className="pv-verdict">
        <span className="pv-stamp">{VERDICT[verdict]}</span>
      </div>
    </div>
  );
}

export interface CompareBar {
  id: string; name: string; total: number; verdict: "eligible" | "review_required" | "ineligible"; recommended: boolean; over: boolean;
}

const TAG = (c: CompareBar) => (c.recommended ? "recommended" : c.over ? "over budget" : c.verdict === "review_required" ? "held for review" : c.verdict === "ineligible" ? "not eligible" : "eligible");

/** Options as bars on one price axis, with the budget as a line that the bars run into. */
export function CompareVisual({ cols, budget, max = 160 }: { cols: CompareBar[]; budget: number; max?: number }) {
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="cv" role="img" aria-label="Option prices against the budget">
      <div className="cv-axis">
        {[0, 40, 80, 120, 160].map((t) => <span key={t} style={{ left: pct(t) }}>${t}</span>)}
      </div>
      <div className="cv-rows">
        <div className="cv-plot" aria-hidden="true"><div className="cv-budget" style={{ left: pct(budget) }}><span>budget ${Math.round(budget)}</span></div></div>
        {cols.map((c) => (
          <div key={c.id} className={`cv-row ${c.verdict} ${c.recommended ? "rec" : ""}`}>
            <div className="cv-name">{c.name.replace(/^Amazon: /, "Amazon · ")}</div>
            <div className="cv-track">
              <div className="cv-bar" style={{ width: pct(Math.min(c.total, budget)) }} />
              {c.total > budget ? <div className="cv-bar over" style={{ left: pct(budget), width: `calc(${pct(c.total)} - ${pct(budget)})` }} /> : null}
              <span className="cv-total" style={{ left: pct(c.total) }}>${c.total.toFixed(2)}</span>
            </div>
            <div className="cv-tag">{TAG(c)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
