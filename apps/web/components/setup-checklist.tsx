"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { Modal } from "./overlays";
import { useApp } from "@/lib/app-context";
import { openBuyerPanel, type BuyerPanel } from "@/lib/buyer-panels";
import { usePassport, useWallets } from "@/lib/queries";
import type { ApprovalDTO, OrderDTO, RequestDTO } from "@/lib/dto";

interface Step { done: boolean; title: string; sub: string; cta: string; href?: string; panel?: BuyerPanel; soon?: boolean }

/**
 * "Get set up": what is left between a new account and a first controlled purchase. It opens as a
 * dialog on the first visit and from a slim bar after that. Every tick is derived from real
 * records, never stored as a flag, so it cannot drift from reality.
 */
export function SetupChecklist({ requests, orders, approvals, ready }: {
  requests: RequestDTO[]; orders: OrderDTO[]; approvals: ApprovalDTO[]; ready: boolean;
}) {
  const { business, mode } = useApp();
  const wallets = useWallets();
  const passport = usePassport();
  const walletLinked = (wallets.data ?? []).some((w) => w.status === "active");
  const passportOn = passport.data?.enabled === true;
  const seenKey = `procura_checklist_seen_${business.id}`;
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  const comparing = requests.find((r) => r.status === "comparing");
  const steps: Step[] = [
    { done: true, title: "Set up your buyer", sub: "Your limits are saved.", href: "/limits", cta: "Review" },
    { done: walletLinked, title: "Connect your wallet", sub: "Sign one message to prove it is yours. Nothing moves and Procura never holds your keys.", panel: "wallet", cta: "Connect" },
    ...(passport.isLoading ? [] : [passportOn
      ? { done: passport.data?.agent != null && passport.data.sessions.some((s) => s.status === "active" && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now())), title: "Let your buyer pay", sub: "Fund it, then approve a spending session with your passkey.", panel: "session" as const, cta: "Set up" }
      : { done: false, soon: true, title: "Let your buyer pay", sub: "Paying opens once Kite Passport is switched on for your account.", panel: "session" as const, cta: "Details" }]),
    { done: requests.length > 0, title: "Make your first request", sub: "Describe what you need and let Procura search for it.", href: "/requests/new", cta: "Create" },
    { done: orders.length > 0, title: "Compare options and make an order", sub: "Pick the one you want from the comparison.", href: comparing ? `/requests/${comparing.id}/compare` : "/requests", cta: "Compare" },
    { done: orders.some((o) => o.approvedAt) || approvals.some((a) => a.destination?.status === "approved"), title: "Approve your first order", sub: "Only you can approve where money goes.", href: "/approvals", cta: "Review" },
  ];
  const core = steps.filter((s) => !s.soon);
  const doneCount = core.filter((s) => s.done).length;
  const finished = doneCount === core.length;

  // Show it once on the first visit while anything is left. After that it waits behind the bar.
  useEffect(() => {
    if (!ready || checked) return;
    setChecked(true);
    if (finished || mode !== "live") return;
    try { if (localStorage.getItem(seenKey) !== "1") setOpen(true); } catch { setOpen(true); }
  }, [ready, checked, finished, mode, seenKey]);

  const close = () => { setOpen(false); try { localStorage.setItem(seenKey, "1"); } catch { /* ignore */ } };

  if (!ready || finished) return null;

  const go = (s: Step) => { close(); if (s.panel) openBuyerPanel(s.panel); };

  return (
    <>
      <div className="card" style={{ padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }} data-checklist>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Get set up <span className="mut3" style={{ fontWeight: 400 }}>· {doneCount} of {core.length} done</span></div>
          <div className="budget-bar" style={{ marginTop: 6 }}><i style={{ width: `${(doneCount / core.length) * 100}%` }} /></div>
        </div>
        <button className="btn btn-pri btn-sm" onClick={() => setOpen(true)}>Continue setup</button>
      </div>

      <Modal open={open} onClose={close} label="Get set up" wide>
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18 }}>Get set up</h3>
              <p className="mut" style={{ fontSize: 12.5, margin: "4px 0 0" }}>{doneCount} of {core.length} done. Here is what is left before your buyer can make its first purchase.</p>
            </div>
            <button className="icon-btn" aria-label="Close" style={{ width: 30, height: 30 }} onClick={close}><Icon name="x" /></button>
          </div>
          <div className="budget-bar" style={{ marginBottom: 6 }}><i style={{ width: `${(doneCount / core.length) * 100}%` }} /></div>
          {steps.map((s) => (
            <div key={s.title} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", border: s.done ? "none" : "1.5px solid var(--line-2)", background: s.done ? "var(--ok)" : "transparent", color: "#fff" }}>
                {s.done ? <Icon name="check" strokeWidth={3} /> : null}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--ink-3)" : "var(--ink)" }}>{s.title}</div>
                <div className="mut3" style={{ fontSize: 12 }}>{s.sub}</div>
              </div>
              {s.done ? null : s.soon ? <span className="pill p-mute">Soon</span>
                : s.panel ? <button className="btn btn-sec btn-sm" onClick={() => go(s)}>{s.cta}</button>
                : <Link href={s.href!} className="btn btn-sec btn-sm" onClick={close}>{s.cta}</Link>}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={close}>Not now</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
