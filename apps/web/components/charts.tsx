"use client";

/**
 * Small SVG charts. Pixel positions use floating point because that is display only; every
 * monetary value is converted from its exact decimal string at the edge and never summed here.
 */

export interface SpendPoint { label: string; value: number }

const compact = (n: number) => (n >= 1000 ? `$${Math.round(n / 100) / 10}k`.replace(".0k", "k") : `$${Math.round(n)}`);

export function SpendChart({ points, budget }: { points: SpendPoint[]; budget?: number | null }) {
  const W = 520, H = 170, L = 44, R = 510, T = 14, B = 150;
  const peak = Math.max(1, ...points.map((p) => p.value), budget ?? 0);
  const max = niceMax(peak);
  const y = (v: number) => B - (v / max) * (B - T);
  const x = (i: number) => (points.length === 1 ? (L + R) / 2 : L + (i * (R - L)) / (points.length - 1));
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Spending over time">
      {ticks.map((t) => <line key={t} x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />)}
      {[0, max / 2, max].map((t) => <text key={t} x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--ink-3)">{compact(t)}</text>)}
      {budget ? <line x1={L} x2={R} y1={y(budget)} y2={y(budget)} stroke="var(--line-2)" strokeWidth={2} strokeDasharray="5 4" /> : null}
      {points.length > 1 ? (
        <>
          <path d={`M${x(0)},${B} L${line.split(" ").join(" L")} L${x(points.length - 1)},${B} Z`} fill="var(--forest-2)" opacity={0.08} />
          <polyline points={line} fill="none" stroke="var(--forest-2)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4.5 : 3} fill={i === points.length - 1 ? "var(--green)" : "var(--forest-2)"} stroke="var(--surface)" strokeWidth={2} />
          <text x={x(i)} y={166} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function niceMax(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function BudgetRing({ used, total }: { used: number; total: number }) {
  const p = total > 0 ? Math.min(1, used / total) : 0;
  const C = 2 * Math.PI * 26;
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" role="img" aria-label={`${Math.round(p * 100)} percent of budget`}>
      <circle cx={32} cy={32} r={26} fill="none" stroke="var(--surface-3)" strokeWidth={7} />
      <circle cx={32} cy={32} r={26} fill="none" stroke="var(--forest-2)" strokeWidth={7} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 32 32)" />
      <text x={32} y={36} textAnchor="middle" fontSize={14} fontWeight={800} fill="var(--ink)">{Math.round(p * 100)}%</text>
    </svg>
  );
}

export function BarList({ rows }: { rows: { label: string; value: number; display: string; color?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 5 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <span className="num" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.display}</span>
          </div>
          <div className="budget-bar"><i style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "linear-gradient(90deg,var(--forest-2),var(--green))" }} /></div>
        </div>
      ))}
    </div>
  );
}
