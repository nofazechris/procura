"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { useApp } from "@/lib/app-context";
import { usePassport, useWallets } from "@/lib/queries";
import type { ApprovalDTO, OrderDTO, RequestDTO } from "@/lib/dto";

/**
 * "Get set up": what is left between a new account and a first controlled purchase. Every tick
 * is derived from real records, never stored as a flag, so it cannot drift from reality.
 */
export function SetupChecklist({ requests, orders, approvals, ready }: {
  requests: RequestDTO[]; orders: OrderDTO[]; approvals: ApprovalDTO[]; ready: boolean;
}) {
  const { business } = useApp();
  const wallets = useWallets();
  const passport = usePassport();
  const walletLinked = (wallets.data ?? []).some((w) => w.status === "active");
  const passportOn = passport.data?.enabled === true;
  const key = `procura_checklist_dismissed_${business.id}`;
  const [dismissed, setDismissed] = useState(true); // hidden until we know, to avoid a flash
  useEffect(() => { try { setDismissed(localStorage.getItem(key) === "1"); } catch { setDismissed(false); } }, [key]);

  const comparing = requests.find((r) => r.status === "comparing");
  const steps = [
    { done: true, title: "Set up your buyer", sub: "Your limits are saved.", href: "/settings/agent-permissions", cta: "Review" },
    { done: requests.length > 0, title: "Make your first request", sub: "Describe what you need and let Procura search for it.", href: "/procurement/new", cta: "Create" },
    { done: orders.length > 0, title: "Compare options and make an order", sub: "Pick the one you want from the comparison.", href: comparing ? `/procurement/${comparing.id}/compare` : "/procurement", cta: "Compare" },
    { done: orders.some((o) => o.approvedAt) || approvals.some((a) => a.destination?.status === "approved"), title: "Approve your first order", sub: "Only addresses you approve can ever be paid.", href: "/approvals", cta: "Review" },
    { done: walletLinked, title: "Connect your wallet", sub: "Link the wallet you pay from by signing a message. Nothing moves and Procura never holds your keys.", href: "/settings/wallets", cta: "Connect" },
    ...(passport.isLoading ? [] : [passportOn
      ? { done: passport.data?.agent != null && passport.data.sessions.some((s) => s.status === "active"), title: "Approve a Kite Passport session", sub: "Set the limits your agent must stay inside, then approve with your passkey.", href: "/settings/passport", cta: "Open" }
      : { done: false, soon: true, title: "Connect Kite Passport", sub: "Lets the agent pay inside limits you set. It needs to be switched on for your account.", href: "/settings/passport", cta: "Details" }]),
  ];
  const core = steps.filter((s) => !("soon" in s));
  const doneCount = core.filter((s) => s.done).length;

  if (!ready || dismissed || doneCount === core.length) return null;

  return (
    <div className="card" style={{ padding: 20, marginBottom: 24 }} data-checklist>
      <div className="sec-head" style={{ marginBottom: 10 }}>
        <div><h2>Get set up</h2><p className="mut" style={{ fontSize: 12.5, marginTop: 2 }}>{doneCount} of {core.length} done</p></div>
        <button className="icon-btn" aria-label="Hide checklist" style={{ width: 30, height: 30 }} onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* ignore */ } setDismissed(true); }}><Icon name="x" /></button>
      </div>
      <div className="budget-bar" style={{ marginBottom: 6 }}><i style={{ width: `${(doneCount / core.length) * 100}%` }} /></div>
      {steps.map((s) => (
        <div key={s.title} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", border: s.done ? "none" : "1.5px solid var(--line-2)", background: s.done ? "var(--ok)" : "transparent", color: "#fff" }}>
            {s.done ? <Icon name="check" strokeWidth={3} /> : null}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--ink-3)" : "var(--ink)" }}>{s.title}</div>
            <div className="mut3" style={{ fontSize: 12 }}>{s.sub}</div>
          </div>
          {s.done ? null : "soon" in s ? <span className="pill p-mute">Soon</span> : <Link href={s.href} className="btn btn-sec btn-sm">{s.cta}</Link>}
        </div>
      ))}
    </div>
  );
}
