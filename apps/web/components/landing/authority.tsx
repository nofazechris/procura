"use client";

import { useMemo, useState } from "react";
import { evaluatePaymentExecution, type ExecutionRejection } from "@procura/policies/core";
import { compare, money, PAYMENT_ASSET, subtract } from "@procura/shared";
import type { LandingData } from "@/lib/landing/data";

const usd = (v: string | number) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const SHORT: Record<ExecutionRejection, string> = {
  POLICY_NOT_ALLOWED: "policy says no",
  SUPPLIER_RESTRICTED: "supplier restricted",
  SESSION_MISSING: "no session",
  SESSION_NOT_ACTIVE: "session not active",
  SESSION_EXPIRED: "session expired",
  SESSION_ASSET_MISMATCH: "wrong asset",
  SESSION_BUDGET_INSUFFICIENT: "more than the session has left",
  SESSION_TX_LIMIT_EXCEEDED: "over the per-payment limit",
  RECIPIENT_NOT_APPROVED: "payee not approved",
  RECIPIENT_MISMATCH: "payee changed",
  ORDER_CHANGED_AFTER_APPROVAL: "order changed",
  DUPLICATE_PAYMENT: "already paid",
  UNSUPPORTED_ASSET: "asset not supported",
  USER_APPROVAL_MISSING: "not approved by a person",
};

const AMOUNTS = ["350.00", "800.00", "1200.00", "2600.00"];
const R = [136, 106, 76];
const CIRC = R.map((r) => 2 * Math.PI * r);

interface LogLine { id: number; amount: string; ok: boolean; why: string }

/**
 * Chapter D. A live session: time, budget and the largest payment it would allow right now.
 * Every payment goes through the same execution gate the server uses; the rings only draw its state.
 */
export function Authority({ data }: { data: LandingData }) {
  const total = Number(data.session.budget);
  const perTx = data.session.perTransaction;
  const minutesTotal = data.session.minutes;
  const [remaining, setRemaining] = useState(data.session.budget);
  const [minutes, setMinutes] = useState(minutesTotal);
  const [log, setLog] = useState<LogLine[]>([]);
  const [flash, setFlash] = useState(0);
  const [seq, setSeq] = useState(0);

  const maxNext = Math.min(Number(perTx), Number(remaining));
  const fracs = [minutes / minutesTotal, Number(remaining) / total, Math.min(1, maxNext / total)];

  const approvedFp = useMemo(() => data.order.fingerprint, [data]);

  function fire(amount: string) {
    const now = new Date();
    const decision = evaluatePaymentExecution({
      now, amount: money(amount, PAYMENT_ASSET), recipientAddress: data.order.recipient, approvedRecipientAddress: data.order.recipient,
      supplierRestricted: false,
      session: { status: "active", asset: PAYMENT_ASSET, remainingAmount: remaining, maxPerTransaction: perTx, expiresAt: new Date(now.getTime() + minutes * 60_000) },
      userApprovalRecorded: true, approvedOrderFingerprint: approvedFp, currentOrderFingerprint: approvedFp, paymentAlreadyExecuted: false,
      supportedAssets: [PAYMENT_ASSET],
      orderPolicy: { allowed: true, requiresApproval: true, reasonCodes: ["WITHIN_BUSINESS_BUDGET"], maxAllowedAmount: remaining, currency: "USD" },
    });
    if (decision.allowed) setRemaining(subtract(money(remaining, PAYMENT_ASSET), money(amount, PAYMENT_ASSET)).amount);
    else setFlash((f) => f + 1);
    const id = seq + 1;
    setSeq(id);
    setLog((l) => [{ id, amount, ok: decision.allowed, why: decision.rejections.map((r) => SHORT[r]).join(" · ") }, ...l].slice(0, 6));
  }

  const reset = () => { setRemaining(data.session.budget); setMinutes(minutesTotal); setLog([]); };
  const exhausted = compare(money(remaining, PAYMENT_ASSET), money("0.00", PAYMENT_ASSET)) <= 0;

  return (
    <section className="lx-sec" id="authority" aria-label="Authority rings">
      <div className="lx-sec-in lx-auth">
        <div className="lx-auth-copy">
          <div className="lx-kicker">Authority rings</div>
          <h2 className="lx-h">A session, not a blank cheque.</h2>
          <p className="lx-body">A person opens a session with a budget, a per-payment cap and a clock. The agent can spend inside it and nowhere else. Fire some payments and watch the rings.</p>

          <div className="lx-fire" role="group" aria-label="Fire a payment">
            {AMOUNTS.map((a) => <button key={a} className="lx-btn" onClick={() => fire(a)}>Pay {usd(a)}</button>)}
          </div>
          <div className="lx-fire sec">
            <button className="lx-btn sm" onClick={() => setMinutes((m) => Math.max(0, m - 10))} disabled={minutes === 0}>Skip 10 minutes</button>
            <button className="lx-btn sm" onClick={reset}>New session</button>
          </div>

          <ul className="lx-log" aria-live="polite">
            {log.length === 0 ? <li className="idle">No payments yet.</li> : log.map((l) => (
              <li key={l.id} className={l.ok ? "ok" : "no"}>
                <b>{usd(l.amount)}</b><span>{l.ok ? "paid inside the session" : `blocked · ${l.why}`}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`lx-rings ${flash ? "shake" : ""}`} key={flash} aria-hidden="true">
          <svg viewBox="0 0 320 320">
            {R.map((r, i) => (
              <g key={r} transform="rotate(-90 160 160)">
                <circle cx="160" cy="160" r={r} className="trk" />
                <circle cx="160" cy="160" r={r} className={`arc a${i}`} strokeDasharray={CIRC[i]} strokeDashoffset={CIRC[i]! * (1 - Math.max(0, Math.min(1, fracs[i]!)))} />
              </g>
            ))}
          </svg>
          <div className="lx-rings-mid">
            <b>{usd(remaining)}</b>
            <span>{exhausted ? "session spent" : minutes === 0 ? "session expired" : `of ${usd(total)} left`}</span>
          </div>
          <ul className="lx-rings-key">
            <li><i className="a0" />time <b>{minutes} min</b></li>
            <li><i className="a1" />budget <b>{usd(remaining)}</b></li>
            <li><i className="a2" />next payment up to <b>{usd(maxNext)}</b></li>
          </ul>
        </div>
      </div>
    </section>
  );
}
