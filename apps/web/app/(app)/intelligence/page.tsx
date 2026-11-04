"use client";

import { useMemo } from "react";
import { BarList, SpendChart } from "@/components/charts";
import { Icon, type IconName } from "@/components/icon";
import { Async, EmptyState, Kpi, PageHead, requestLabel } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { averageCycleDays, isActiveRequest, monthlySpend, spendBySupplier, spentOrders, totalOf } from "@/lib/derive";
import { moneyShort } from "@/lib/format";
import { useApprovals, useOrders, useRequests, useSavingsEstimate } from "@/lib/queries";
import { fromUnits } from "@procura/shared";

export default function IntelligencePage() {
  const { business } = useApp();
  const cur = business.defaultCurrency;
  const orders = useOrders();
  const requests = useRequests();
  const approvals = useApprovals();

  const reqs = requests.data ?? [];
  const ords = orders.data ?? [];
  const comparing = reqs.filter((r) => r.status === "comparing" || r.status === "awaiting_approval").map((r) => r.id);
  const savings = useSavingsEstimate(comparing);

  const spent = useMemo(() => spentOrders(ords, cur), [ords, cur]);
  const series = useMemo(() => monthlySpend(ords, cur), [ords, cur]);
  const bySupplier = useMemo(() => spendBySupplier(ords, cur), [ords, cur]);
  const cycle = useMemo(() => averageCycleDays(reqs, ords), [reqs, ords]);
  const totalUnits = bySupplier.reduce((a, b) => a + b.units, 0n);

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reqs) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [reqs]);

  const insights: { icon: IconName; tone: string; text: React.ReactNode }[] = [];
  const top = bySupplier[0];
  if (top && totalUnits > 0n) {
    const share = Number((top.units * 1000n) / totalUnits) / 10;
    if (bySupplier.length === 1) insights.push({ icon: "users", tone: "var(--info)", text: <><b>All of your spend is with one supplier ({top.name}).</b> Adding a backup vendor would reduce fulfilment risk.</> });
    else if (share >= 50) insights.push({ icon: "users", tone: "var(--info)", text: <><b>{top.name} accounts for {share}% of your spend.</b> A second source for these items would reduce fulfilment risk.</> });
  }
  if (savings.count) insights.push({ icon: "trend", tone: "var(--ok)", text: <><b>{moneyShort(savings.amount, savings.currency)} of estimated savings</b> across {savings.count} comparison{savings.count === 1 ? "" : "s"}, measured against the highest eligible quote. Estimated, not realised.</> });
  const stale = (approvals.data ?? []).filter((a) => a.status === "pending" && Date.now() - new Date(a.createdAt).getTime() > 86_400_000);
  if (stale.length) insights.push({ icon: "alert", tone: "var(--warn)", text: <><b>{stale.length} approval{stale.length === 1 ? " has" : "s have"} been waiting more than a day.</b> Orders cannot be paid until they are decided.</> });

  const loading = orders.isPending || requests.isPending;
  const hasSpend = spent.length > 0;

  return (
    <>
      <PageHead title="Procurement intelligence" sub="Understand your purchasing performance and find opportunities to improve." />
      <Async query={orders}>
        {() => (
          <>
            <div className="kpis">
              <Kpi label="Total expenditure" icon="grid" value={loading ? "…" : moneyShort(totalOf(spent, cur), cur)} sub={`${spent.length} paid ${spent.length === 1 ? "order" : "orders"}, all time`} />
              <Kpi label="Estimated savings" icon="trend" tone={savings.count ? "up" : undefined} value={savings.count ? moneyShort(savings.amount, savings.currency) : "-"} sub={savings.count ? "estimated, not realised" : "needs compared quotes"} />
              <Kpi label="Requests" icon="pkg" value={reqs.length} sub={`${reqs.filter(isActiveRequest).length} in progress`} />
              <Kpi label="Avg cycle time" icon="clock" value={cycle === null ? "-" : `${cycle < 1 ? "<1" : cycle.toFixed(1)} days`} sub={cycle === null ? "needs an approved order" : "request to approval"} />
            </div>

            <div className="two-col">
              <div className="card" style={{ padding: 20 }}>
                <div className="sec-head"><h2>Spend over time</h2><span className="chip">6 months</span></div>
                {hasSpend ? <SpendChart points={series} /> : <EmptyState icon="chart" title="No spend yet">Spend appears once orders are paid.</EmptyState>}
              </div>
              <div className="card" style={{ padding: 20 }}>
                <div className="sec-head"><h2>Spend by supplier</h2></div>
                {bySupplier.length === 0 ? <EmptyState icon="users" title="No supplier spend yet" /> : (
                  <BarList rows={bySupplier.slice(0, 6).map((s) => ({
                    label: s.name, value: Number(s.units / 10_000n), display: `${moneyShort(fromUnits(s.units, 6, 2), cur)} · ${Number((s.units * 1000n) / (totalUnits || 1n)) / 10}%`,
                  }))} />
                )}
              </div>
            </div>

            <div className="two-col" style={{ marginTop: 16 }}>
              <div className="card" style={{ padding: 20 }}>
                <div className="sec-head"><h2>Requests by status</h2></div>
                {statusCounts.length === 0 ? <EmptyState icon="pkg" title="No requests yet" /> : (
                  <BarList rows={statusCounts.map(([s, n]) => ({ label: requestLabel(s as never), value: n, display: String(n), color: "linear-gradient(90deg,var(--info),var(--green))" }))} />
                )}
              </div>
              <div className="card" style={{ padding: 20 }}>
                <div className="sec-head"><h2>Insights</h2></div>
                {insights.length === 0 ? <EmptyState icon="spark" title="Nothing notable yet">Insights appear as you buy more. Each one is derived from your own records.</EmptyState> : insights.map((i, k) => (
                  <div key={k} className="insight"><div className="ic" style={{ color: i.tone }}><Icon name={i.icon} /></div><p>{i.text}</p></div>
                ))}
                <p className="mut3" style={{ fontSize: 12, marginTop: 8 }}>Insights come from your procurement records. Estimated savings are shown separately from realised savings and use a stated baseline.</p>
              </div>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
