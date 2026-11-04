"use client";

import { useMemo, useState } from "react";
import { canonicalOrder, evaluatePaymentExecution, type ExecutionInput, type ExecutionRejection } from "@procura/policies/core";
import { add, compare, money, PAYMENT_ASSET, subtract } from "@procura/shared";
import type { LandingData } from "@/lib/landing/data";
import { REJECTION_TEXT, sha256, usd } from "@/lib/landing/text";
import { Scene3D } from "../three-kit";
import type { LimitsProps } from "../scenes/limits";
import { Split } from "./split";

const load = () => import("../scenes/limits");
const PAYEE = "marketplace-checkout";
const AMOUNTS = ["12.00", "25.00", "40.00", "80.00"];

interface Attack { id: string; label: string; hint: string }
const ATTACKS: Attack[] = [
  { id: "honest", label: "Pay as approved", hint: "The control: nothing is wrong." },
  { id: "redirect", label: "Change the payee", hint: "Send it somewhere else." },
  { id: "edit", label: "Edit the basket", hint: "Raise one price by a cent." },
  { id: "overspend", label: "Overspend", hint: "Ask for more than the cap." },
  { id: "expired", label: "Use an old session", hint: "It ended a minute ago." },
  { id: "twice", label: "Pay twice", hint: "Send the same order again." },
  { id: "skip", label: "Skip the human", hint: "No one approved it." },
  { id: "restricted", label: "Blocked supplier", hint: "A restricted payee." },
  { id: "asset", label: "Switch currency", hint: "An unsupported asset." },
];

interface Outcome { label: string; allowed: boolean; amount: string; rejections: ExecutionRejection[]; hashes?: { approved: string; current: string } }

export function LimitsSection({ data }: { data: LandingData }) {
  const total = data.session.budget;
  const perTx = data.session.perTransaction;
  const [remaining, setRemaining] = useState(total);
  const [minutes, setMinutes] = useState(data.session.minutes);
  const [event, setEvent] = useState<LimitsProps["event"]>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [seq, setSeq] = useState(0);

  const fire = (kind: "paid" | "blocked") => { setSeq((n) => n + 1); setEvent({ id: seq + 1, kind }); };

  const fingerprintInput = useMemo(() => ({
    supplierId: data.recommendedId, currency: "USD", paymentAsset: PAYMENT_ASSET, recipientAddress: PAYEE,
    subtotal: data.order.subtotal, deliveryCost: data.order.delivery, totalAmount: data.order.total, items: data.order.lines,
  }), [data]);

  const base = (rem: string, mins: number): ExecutionInput => {
    const now = new Date();
    // A normal payment for what is left, so an attack shows only its own violation and not a spent session.
    const normal = Number(rem) > 0 && Number(rem) < Number(perTx) ? rem : perTx;
    return {
      now, amount: money(normal, PAYMENT_ASSET), recipientAddress: PAYEE, approvedRecipientAddress: PAYEE, supplierRestricted: false,
      session: { status: "active", asset: PAYMENT_ASSET, remainingAmount: rem, maxPerTransaction: perTx, expiresAt: new Date(now.getTime() + mins * 60_000) },
      userApprovalRecorded: true, approvedOrderFingerprint: data.order.fingerprint, currentOrderFingerprint: data.order.fingerprint,
      paymentAlreadyExecuted: false, supportedAssets: [PAYMENT_ASSET],
      orderPolicy: { allowed: true, requiresApproval: true, reasonCodes: ["WITHIN_BUSINESS_BUDGET"], maxAllowedAmount: rem, currency: "USD" },
    };
  };

  function pay(amount: string) {
    const d = evaluatePaymentExecution({ ...base(remaining, minutes), amount: money(amount, PAYMENT_ASSET) });
    if (d.allowed) setRemaining(subtract(money(remaining, "USD"), money(amount, "USD")).amount);
    fire(d.allowed ? "paid" : "blocked");
    setOutcome({ label: `Pay ${usd(amount)}`, allowed: d.allowed, amount, rejections: d.rejections });
  }

  async function attack(a: Attack) {
    const input = base(remaining, minutes);
    let used = input, hashes: Outcome["hashes"];
    switch (a.id) {
      case "redirect": used = { ...input, recipientAddress: "someone-else" }; break;
      case "edit": {
        const lines = data.order.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: add(money(l.unitPrice, "USD"), money("0.01", "USD")).amount } : l));
        const current = await sha256(canonicalOrder({ ...fingerprintInput, items: lines }));
        used = { ...input, currentOrderFingerprint: current };
        hashes = { approved: await sha256(canonicalOrder(fingerprintInput)), current };
        break;
      }
      case "overspend": used = { ...input, amount: money(add(money(total, "USD"), money("40.00", "USD")).amount, PAYMENT_ASSET) }; break;
      case "expired": used = { ...input, session: { ...input.session!, expiresAt: new Date(Date.now() - 60_000) } }; break;
      case "twice": used = { ...input, paymentAlreadyExecuted: true }; break;
      case "skip": used = { ...input, userApprovalRecorded: false }; break;
      case "restricted": used = { ...input, supplierRestricted: true }; break;
      case "asset": used = { ...input, amount: money(input.amount.amount, "USDT") }; break;
    }
    const d = evaluatePaymentExecution(used);
    fire(d.allowed ? "paid" : "blocked");
    setOutcome({ label: a.label, allowed: d.allowed, amount: used.amount.amount, rejections: d.rejections, ...(hashes ? { hashes } : {}) });
  }

  const reset = () => { setRemaining(total); setMinutes(data.session.minutes); setOutcome(null); };
  const left = Math.max(0, Number(remaining));
  const props = useMemo<LimitsProps>(() => ({
    time: minutes / data.session.minutes, budget: left / Number(total), next: Math.min(Number(perTx), left) / Number(total), event,
  }), [minutes, left, total, perTx, event, data.session.minutes]);

  const spent = compare(money(remaining, "USD"), money("0", "USD")) <= 0;

  return (
    <Split
      id="limits" side="right" kicker="Try it · Limits" title="A session, not a blank cheque."
      caption="Time, budget and the biggest next payment. Fire a payment, or try to fool the gate."
      bg={<Scene3D load={load} props={props} side="right" label="Three rings that drain as an agent spends inside its approved session" />}
      visual={
        <div className="lx-ring-key" aria-hidden="true">
          <span><i className="a0" />time {minutes} min</span><span><i className="a1" />budget {usd(left)}</span><span><i className="a2" />next up to {usd(Math.min(Number(perTx), left))}</span>
        </div>
      }
    >
      <p className="lx-body">
        You approve one session: {usd(total)} to spend, for {data.session.minutes} minutes. Procura asks for no more than your
        policy allows, and Kite Passport enforces it. The same check that guards every real payment runs here, in your browser.
      </p>
      <div className="lx-fire" role="group" aria-label="Fire a payment">
        {AMOUNTS.map((a) => <button key={a} className="lx-btn sm" onClick={() => pay(a)}>Pay {usd(a)}</button>)}
        <button className="lx-btn sm ghost" onClick={() => setMinutes((m) => Math.max(0, m - 10))} disabled={minutes === 0}>Skip 10 min</button>
        <button className="lx-btn sm ghost" onClick={reset}>New session</button>
      </div>
      <div className="lx-atk" role="group" aria-label="Attacks on the payment gate">
        {ATTACKS.map((a) => <button key={a.id} className={outcome?.label === a.label ? "on" : ""} onClick={() => void attack(a)} title={a.hint}>{a.label}</button>)}
      </div>
      <div className={`lx-out ${outcome ? (outcome.allowed ? "ok" : "no") : ""}`} aria-live="polite">
        {outcome ? (
          <>
            <div className="lx-out-h"><span className="stamp">{outcome.allowed ? "Allowed" : "Blocked"}</span><span>{outcome.label} · {usd(outcome.amount)}</span></div>
            {outcome.allowed ? <p>Every restriction held, so the payment goes through inside the session.</p>
              : <ul>{outcome.rejections.map((r) => <li key={r}><code>{r}</code>{REJECTION_TEXT[r]}</li>)}</ul>}
            {outcome.hashes ? (
              <div className="lx-hash"><div><i>approved</i><code>{outcome.hashes.approved.slice(0, 28)}…</code></div><div><i>now</i><code className="bad">{outcome.hashes.current.slice(0, 28)}…</code></div></div>
            ) : null}
          </>
        ) : <p>{spent ? "The session is spent." : "Try a payment or an attack. The gate names every rule it enforces."}</p>}
      </div>
    </Split>
  );
}
