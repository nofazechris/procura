"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AgentPanel } from "@/components/agent";
import { SpendChart } from "@/components/charts";
import { SetupChecklist } from "@/components/setup-checklist";
import { Icon, type IconName } from "@/components/icon";
import { EmptyState, Kpi, PageHead, RequestStatusPill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { describeActivity } from "@/lib/activity";
import { isActiveRequest, monthlySpend, spentOrders, totalOf } from "@/lib/derive";
import { amount, firstName, greeting, moneyShort, relativeTime, shortDate } from "@/lib/format";
import { useActivity, useApprovals, useOrders, usePolicy, useRequests, useSavingsEstimate } from "@/lib/queries";

export default function DashboardPage() {
  const { user, business } = useApp();
  const router = useRouter();
  const requests = useRequests();
  const orders = useOrders();
  const approvals = useApprovals();
  const activity = useActivity();
  const policy = usePolicy();

  const cur = business.defaultCurrency;
  const reqs = requests.data ?? [];
  const ords = orders.data ?? [];
  const pendingApprovals = (approvals.data ?? []).filter((a) => a.status === "pending");
  const active = reqs.filter(isActiveRequest);

  const spend30 = useMemo(() => spentOrders(ords, cur, Date.now() - 30 * 86_400_000), [ords, cur]);
  const series = useMemo(() => monthlySpend(ords, cur), [ords, cur]);
  const hasSpend = series.some((p) => p.value > 0);

  const comparing = reqs.filter((r) => r.status === "comparing" || r.status === "awaiting_approval").map((r) => r.id);
  const savings = useSavingsEstimate(comparing);

  const loading = requests.isPending || orders.isPending;
  const counts = (s: string) => active.filter((r) => r.status === s).length;
  const activeSub = active.length === 0 ? "Nothing in progress" : [
    counts("comparing") ? `${counts("comparing")} comparing` : "", counts("awaiting_approval") ? `${counts("awaiting_approval")} awaiting approval` : "",
    counts("approved") ? `${counts("approved")} approved` : "",
  ].filter(Boolean).join(" · ") || `${active.length} in progress`;

  const attention: { icon: IconName; tone: "warn" | "info" | "ok"; title: string; sub: string; href: string; tag: string }[] = [];
  if (pendingApprovals.length) attention.push({ icon: "shield", tone: "warn", title: `${pendingApprovals.length} ${pendingApprovals.length === 1 ? "order is" : "orders are"} waiting for your approval`, sub: pendingApprovals.slice(0, 2).map((a) => `${a.orderNumber} · ${a.supplierName}`).join(", "), href: "/approvals", tag: "Review" });
  for (const r of reqs.filter((x) => x.status === "comparing").slice(0, 2)) attention.push({ icon: "scale", tone: "info", title: `Quotes ready to compare: ${r.title}`, sub: `${r.requestNumber} · pick a supplier to prepare the purchase order`, href: `/procurement/${r.id}/compare`, tag: "Compare" });
  for (const r of reqs.filter((x) => x.status === "draft").slice(0, 1)) attention.push({ icon: "bolt", tone: "info", title: `Draft not started: ${r.title}`, sub: `${r.requestNumber} · start sourcing to get quotes`, href: `/procurement/${r.id}`, tag: "Start" });
  const unapproved = (approvals.data ?? []).filter((a) => a.status === "pending" && a.destination?.status === "pending");
  if (unapproved.length) attention.push({ icon: "wallet", tone: "warn", title: "A supplier payment address needs approval", sub: `${unapproved[0]!.supplierName} · only addresses you approve can be paid`, href: "/approvals", tag: "Approve" });

  return (
    <>
      <PageHead
        eyebrow={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
        title={`${greeting()}, ${firstName(user.name)}.`}
        sub="Here is what is happening across your procurement operations."
        actions={<>
          <Link href="/assistant" className="btn btn-sec"><Icon name="msg" /> Talk to Procura</Link>
          <Link href="/procurement/new" className="btn btn-pri"><Icon name="plus" /> New procurement</Link>
        </>}
      />

      <SetupChecklist requests={reqs} orders={ords} approvals={approvals.data ?? []} ready={!loading && !approvals.isPending} />

      <div className="kpis">
        <Kpi label="Procurement spend" icon="grid" tone={spend30.length ? "up" : undefined} value={loading ? "…" : moneyShort(totalOf(spend30, cur), cur)}
          sub={spend30.length ? `${spend30.length} paid ${spend30.length === 1 ? "order" : "orders"} in 30 days` : "No paid orders in 30 days"} />
        <Kpi label="Active procurement" icon="pkg" value={loading ? "…" : active.length} sub={activeSub} />
        <Kpi label="Potential savings" icon="trend" tone={savings.count ? "up" : undefined}
          value={savings.loading ? "…" : savings.count ? moneyShort(savings.amount, savings.currency) : "-"}
          sub={savings.count ? "estimated, vs highest eligible quotes" : "Appears once quotes are compared"} />
        <Kpi label="Pending approvals" icon="shield" value={approvals.isPending ? "…" : pendingApprovals.length}
          sub={pendingApprovals.length ? "need your authorisation" : "Nothing waiting"} />
      </div>

      <div className="grid-main">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="sec-head"><h2>Active procurement</h2><Link href="/procurement">View all</Link></div>
            {active.length === 0 && !loading ? (
              <EmptyState icon="pkg" title="Nothing in progress" action={<Link href="/procurement/new" className="btn btn-pri btn-sm"><Icon name="plus" /> New procurement</Link>}>
                Create a request and Procura will source and compare suppliers.
              </EmptyState>
            ) : (
              <div className="tbl-wrap" style={{ border: "none", boxShadow: "none" }}>
                <table className="tbl">
                  <thead><tr><th>Request</th><th>Status</th><th>Budget</th><th>Created</th></tr></thead>
                  <tbody>
                    {active.slice(0, 5).map((r) => (
                      <tr key={r.id} className="row-link" onClick={() => router.push(`/procurement/${r.id}`)}>
                        <td><Link href={`/procurement/${r.id}`} style={{ textDecoration: "none" }}><b>{r.title}</b></Link><div className="mut3" style={{ fontSize: 11.5 }}>{r.requestNumber}</div></td>
                        <td><RequestStatusPill status={r.status} /></td>
                        <td className="num">{moneyShort(r.budgetAmount, r.currency)}</td>
                        <td className="mut num">{shortDate(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card chart-wrap">
            <div className="sec-head"><h2>Spending overview</h2><span className="chip">Last 6 months</span></div>
            {hasSpend ? (
              <>
                <div className="chart-legend">
                  <span><span className="lg-dot" style={{ background: "var(--forest-2)" }} />Actual spend</span>
                  {policy.data ? <span><span className="lg-dot" style={{ background: "var(--line-2)" }} />Monthly limit {moneyShort(policy.data.maxTotalSpend, cur)}</span> : null}
                </div>
                <SpendChart points={series} budget={policy.data ? Number(amount(policy.data.maxTotalSpend, 0).replace(/,/g, "")) : null} />
              </>
            ) : (
              <EmptyState icon="chart" title="No spend yet">Spend appears here once purchase orders are paid.</EmptyState>
            )}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="sec-head"><h2>Needs attention</h2></div>
            {attention.length === 0 ? (
              <EmptyState icon="check" title="You are all caught up">No approvals or comparisons are waiting on you.</EmptyState>
            ) : attention.map((a) => (
              <Link key={a.title} href={a.href} className="opp" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="oic" style={{ background: `var(--${a.tone === "warn" ? "warn" : a.tone === "ok" ? "ok" : "info"}-bg)`, color: `var(--${a.tone === "warn" ? "warn" : a.tone === "ok" ? "ok" : "info"})` }}><Icon name={a.icon} /></div>
                <div style={{ flex: 1, minWidth: 0 }}><h4>{a.title}</h4><p>{a.sub}</p></div>
                <span className={`pill p-${a.tone}`}>{a.tag}</span>
              </Link>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <AgentPanel request={active[0]} />
          <div className="card" style={{ padding: 20 }}>
            <div className="sec-head"><h2>Procurement activity</h2><Link href="/activity">All</Link></div>
            {(activity.data ?? []).length === 0 ? (
              <EmptyState icon="clock" title="No activity yet">Actions appear here as they happen.</EmptyState>
            ) : (
              <div className="feed">
                {(activity.data ?? []).slice(0, 5).map((a) => {
                  const v = describeActivity(a);
                  return (
                    <Link key={a.id} href={v.href} className="feed-i" style={{ textDecoration: "none", color: "inherit" }}>
                      <div className="feed-dot" style={v.ok ? { background: "var(--ok-bg)", color: "var(--ok)" } : undefined}><Icon name={v.icon} /></div>
                      <div style={{ minWidth: 0 }}><div className="ft">{v.title}</div><div className="fs">{[v.sub, relativeTime(a.createdAt)].filter(Boolean).join(" · ")}</div></div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
