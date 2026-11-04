"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AgentPanel } from "@/components/agent";
import { SetupChecklist } from "@/components/setup-checklist";
import { Icon, type IconName } from "@/components/icon";
import { EmptyState, Kpi, PageHead, RequestStatusPill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import { describeActivity } from "@/lib/activity";
import { isActiveRequest, spentOrders, totalOf } from "@/lib/derive";
import { firstName, greeting, minus, moneyShort, relativeTime, shortDate } from "@/lib/format";
import { useActivity, useApprovals, useOrders, usePassport, usePolicy, useRequests, useSavingsEstimate } from "@/lib/queries";

export default function DashboardPage() {
  const { user, business, mode } = useApp();
  const router = useRouter();
  const requests = useRequests();
  const orders = useOrders();
  const approvals = useApprovals();
  const activity = useActivity();
  const policy = usePolicy();
  const passport = usePassport();
  const [ask, setAsk] = useState("");

  const cur = business.defaultCurrency;
  const reqs = requests.data ?? [];
  const ords = orders.data ?? [];
  const pendingApprovals = (approvals.data ?? []).filter((a) => a.status === "pending");
  const active = reqs.filter(isActiveRequest);

  const monthStart = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }, []);
  const spentMonth = useMemo(() => spentOrders(ords, cur, monthStart), [ords, cur, monthStart]);
  const spentTotal = totalOf(spentMonth, cur);
  const limit = policy.data?.maxTotalSpend ?? null;
  const left = limit ? minus(limit, spentTotal) : null;
  const used = limit && Number(limit) > 0 ? Math.min(100, Math.max(0, (Number(spentTotal) / Number(limit)) * 100)) : 0;

  const comparing = reqs.filter((r) => r.status === "comparing" || r.status === "awaiting_approval").map((r) => r.id);
  const savings = useSavingsEstimate(comparing);

  const loading = requests.isPending || orders.isPending;
  const counts = (s: string) => active.filter((r) => r.status === s).length;
  const activeSub = active.length === 0 ? "Nothing in progress" : [
    counts("comparing") ? `${counts("comparing")} to compare` : "", counts("awaiting_approval") ? `${counts("awaiting_approval")} waiting for you` : "",
    counts("approved") ? `${counts("approved")} approved` : "",
  ].filter(Boolean).join(" · ") || `${active.length} in progress`;

  const attention: { icon: IconName; tone: "warn" | "info" | "ok"; title: string; sub: string; href: string; tag: string }[] = [];
  if (pendingApprovals.length) attention.push({ icon: "shield", tone: "warn", title: `${pendingApprovals.length} ${pendingApprovals.length === 1 ? "purchase is" : "purchases are"} waiting for your OK`, sub: pendingApprovals.slice(0, 2).map((a) => `${a.orderNumber} · ${a.supplierName}`).join(", "), href: "/approvals", tag: "Review" });
  for (const r of reqs.filter((x) => x.status === "comparing").slice(0, 2)) attention.push({ icon: "scale", tone: "info", title: `Options ready: ${r.title}`, sub: `${r.requestNumber} · pick one to prepare the order`, href: `/procurement/${r.id}/compare`, tag: "Compare" });
  for (const r of reqs.filter((x) => x.status === "draft").slice(0, 1)) attention.push({ icon: "bolt", tone: "info", title: `Not started: ${r.title}`, sub: `${r.requestNumber} · start the search to see options`, href: `/procurement/${r.id}`, tag: "Start" });
  const unapproved = (approvals.data ?? []).filter((a) => a.status === "pending" && a.destination?.status === "pending");
  if (unapproved.length) attention.push({ icon: "wallet", tone: "warn", title: "A payment address needs your OK", sub: `${unapproved[0]!.supplierName} · only addresses you approve can be paid`, href: "/approvals", tag: "Approve" });

  const sessions = (passport.data?.sessions ?? []).filter((s) => s.status === "active" && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now()));
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const q = ask.trim();
    router.push(q ? `/procurement/new?q=${encodeURIComponent(q)}` : "/procurement/new");
  };

  return (
    <>
      <PageHead
        eyebrow={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
        title={`${greeting()}, ${firstName(user.name)}.`}
        sub="Tell Procura what you need. It finds the options, checks them and asks before it spends."
        actions={<Link href="/assistant" className="btn btn-sec"><Icon name="agent" /> Ask Procura</Link>}
      />

      <form className="card dash-ask" onSubmit={go} role="search">
        <label htmlFor="dash-ask" className="dash-ask-l">What do you need to buy?</label>
        <div className="dash-ask-r">
          <input id="dash-ask" className="input" value={ask} maxLength={300} onChange={(e) => setAsk(e.target.value)}
            placeholder={mode === "demo" ? "50 bags of basmati rice under $2,000" : "A 65W USB-C charger and two label rolls, under $60"} />
          <button className="btn btn-pri" type="submit"><Icon name="bolt" /> Find it</button>
        </div>
        <p className="mut3" style={{ fontSize: 12, margin: "8px 0 0" }}>Searching is free and buys nothing. You see every option before anything is ordered.</p>
      </form>

      <SetupChecklist requests={reqs} orders={ords} approvals={approvals.data ?? []} ready={!loading && !approvals.isPending} />

      <div className="kpis">
        <Kpi label="Spent this month" icon="card" value={loading ? "…" : moneyShort(spentTotal, cur)}
          sub={limit ? `of ${moneyShort(limit, cur)} monthly limit` : spentMonth.length ? `${spentMonth.length} paid ${spentMonth.length === 1 ? "order" : "orders"}` : "Nothing spent yet"} />
        <Kpi label="Looking for" icon="pkg" value={loading ? "…" : active.length} sub={activeSub} />
        <Kpi label="You could save" icon="trend" tone={savings.count ? "up" : undefined}
          value={savings.loading ? "…" : savings.count ? moneyShort(savings.amount, savings.currency) : "-"}
          sub={savings.count ? "estimated, against the dearest option" : "Appears once options are compared"} />
        <Kpi label="Waiting for you" icon="shield" value={approvals.isPending ? "…" : pendingApprovals.length}
          sub={pendingApprovals.length ? "need your OK" : "Nothing waiting"} />
      </div>

      <div className="grid-main">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="sec-head"><h2>In progress</h2><Link href="/procurement">All requests</Link></div>
            {active.length === 0 && !loading ? (
              <EmptyState icon="pkg" title="Nothing in progress" action={<Link href="/procurement/new" className="btn btn-pri btn-sm"><Icon name="plus" /> New request</Link>}>
                Describe something you need and Procura will find options and compare them.
              </EmptyState>
            ) : (
              <div className="tbl-wrap" style={{ border: "none", boxShadow: "none" }}>
                <table className="tbl">
                  <thead><tr><th>Request</th><th>Status</th><th>Budget</th><th>Started</th></tr></thead>
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

          <div className="card" style={{ padding: 20 }}>
            <div className="sec-head"><h2>Needs you</h2></div>
            {attention.length === 0 ? (
              <EmptyState icon="check" title="You are all caught up">Nothing is waiting on you.</EmptyState>
            ) : attention.map((a) => (
              <Link key={`${a.href}|${a.title}`} href={a.href} className="opp" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="oic" style={{ background: `var(--${a.tone === "warn" ? "warn" : a.tone === "ok" ? "ok" : "info"}-bg)`, color: `var(--${a.tone === "warn" ? "warn" : a.tone === "ok" ? "ok" : "info"})` }}><Icon name={a.icon} /></div>
                <div style={{ flex: 1, minWidth: 0 }}><h4>{a.title}</h4><p>{a.sub}</p></div>
                <span className={`pill p-${a.tone}`}>{a.tag}</span>
              </Link>
            ))}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="sec-head"><h2>Recent activity</h2><Link href="/activity">All</Link></div>
            {(activity.data ?? []).length === 0 ? (
              <EmptyState icon="clock" title="No activity yet">What Procura does for you appears here as it happens.</EmptyState>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <AgentPanel request={active[0]} />

          <div className="card" style={{ padding: 20 }}>
            <div className="sec-head"><h2>Your limits</h2><Link href="/settings/agent-permissions">Change</Link></div>
            {policy.data ? (
              <>
                <div className="dash-meter" role="img" aria-label={`${Math.round(used)} percent of the monthly limit spent`}><i style={{ width: `${used}%` }} /></div>
                <div className="appr-row"><span className="mut">Left this month</span><span className="v num">{left ? moneyShort(left, cur) : "-"}</span></div>
                <div className="appr-row"><span className="mut">Largest purchase</span><span className="v num">{moneyShort(policy.data.maxTransactionAmount, cur)}</span></div>
                <div className="appr-row"><span className="mut">Asks you</span><span className="v">{policy.data.approvalRequiredAbove ? `above ${moneyShort(policy.data.approvalRequiredAbove, cur)}` : "every time"}</span></div>
                <div className="appr-row"><span className="mut">Spending session</span><span className="v">{mode === "demo" ? "Not in the demo" : sessions.length ? `${sessions.length} active` : "None active"}</span></div>
                {mode === "live" && !sessions.length ? <p className="mut3" style={{ fontSize: 12, marginTop: 10 }}>The agent can search now. To let it pay, approve a session with your passkey in <Link href="/settings/passport" style={{ textDecoration: "underline" }}>Kite Passport</Link>.</p> : null}
              </>
            ) : <p className="mut3" style={{ fontSize: 13 }}>Loading your limits…</p>}
          </div>
        </div>
      </div>
    </>
  );
}
