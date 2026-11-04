"use client";

import { useEffect, useMemo, useState } from "react";
import { canonicalOrder, evaluatePaymentExecution, type ExecutionInput, type ExecutionRejection } from "@procura/policies/core";
import { compareQuotations, evaluateEligibility, type Priority } from "@procura/procurement/core";
import { add, money, PAYMENT_ASSET, type SupplierEvidenceSummary } from "@procura/shared";
import type { LandingData } from "@/lib/landing/data";

const usd = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const DAY = 86_400_000;

const REASON_TEXT: Record<string, string> = {
  OVER_BUDGET: "over budget",
  MISSING_ITEMS: "an item is not quoted",
  INSUFFICIENT_QUANTITY: "not enough stock quoted",
  LATE_DELIVERY: "too slow",
  UNAVAILABLE: "unavailable",
  QUOTE_EXPIRED: "quote expired",
  IDENTITY_NOT_VERIFIED: "identity not verified",
  IDENTITY_FAILED: "identity check failed",
  CONTACT_NOT_VERIFIED: "contact not verified",
  PAYMENT_DESTINATION_NOT_VERIFIED: "payout address not verified",
  PAYMENT_DESTINATION_MISMATCH: "payout address does not match",
  SUPPLIER_RESTRICTED: "supplier restricted",
  PARTIAL_AVAILABILITY: "partial availability",
  AVAILABILITY_UNKNOWN: "availability unknown",
  DELIVERY_UNKNOWN: "delivery unknown",
};
const reasonText = (c: string) => REASON_TEXT[c] ?? c.toLowerCase().replace(/_/g, " ");

const REJECTION_TEXT: Record<ExecutionRejection, string> = {
  POLICY_NOT_ALLOWED: "The spending policy does not allow this order.",
  SUPPLIER_RESTRICTED: "This supplier is on the restricted list.",
  SESSION_MISSING: "There is no authorised session.",
  SESSION_NOT_ACTIVE: "The session is not active.",
  SESSION_EXPIRED: "The session has expired.",
  SESSION_ASSET_MISMATCH: "The session covers a different asset.",
  SESSION_BUDGET_INSUFFICIENT: "The payment is more than the session has left.",
  SESSION_TX_LIMIT_EXCEEDED: "The payment is over the per-payment limit.",
  RECIPIENT_NOT_APPROVED: "No payout address was approved by a person.",
  RECIPIENT_MISMATCH: "The address is not the one a person approved.",
  ORDER_CHANGED_AFTER_APPROVAL: "The order no longer matches what was approved.",
  DUPLICATE_PAYMENT: "This order has already been paid.",
  UNSUPPORTED_ASSET: "That asset is not supported.",
  USER_APPROVAL_MISSING: "No person approved this payment.",
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Chapter C: change the inputs, the real comparison engine re-runs.   */
/* ------------------------------------------------------------------ */

type EvKey = "identityVerified" | "contactVerified" | "paymentDestinationMatched";
const EV: { key: EvKey; label: string }[] = [
  { key: "identityVerified", label: "ID" },
  { key: "contactVerified", label: "Contact" },
  { key: "paymentDestinationMatched", label: "Payout" },
];
const PRIORITIES: { id: Priority; label: string }[] = [
  { id: "price", label: "Lowest price" },
  { id: "speed", label: "Fastest" },
  { id: "reliability", label: "Most reliable" },
];

function Compare({ data }: { data: LandingData }) {
  const [budget, setBudget] = useState(2000);
  const [priority, setPriority] = useState<Priority>("price");
  const [ev, setEv] = useState<Record<string, SupplierEvidenceSummary>>(data.seed.evidence);
  const now = useMemo(() => new Date(), []);

  const result = useMemo(() => {
    // The page is prerendered, so quote validity is re-based on the visitor's clock.
    const quotes = data.seed.quotes.map((q) => ({ ...q, validUntil: new Date(now.getTime() + 7 * DAY) }));
    const requirement = { ...data.seed.requirement, budget: budget.toFixed(2) };
    const evMap = new Map(Object.entries(ev));
    const eligibilities = quotes.map((q) => evaluateEligibility(q, requirement, { supplierId: q.supplierId, restricted: false, evidence: evMap.get(q.supplierId)! }, now));
    return compareQuotations({ currency: "USD", quotes, eligibilities, evidenceBySupplier: evMap, priorities: [priority] });
  }, [data, budget, priority, ev, now]);

  const rows = [...result.rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const nameOf = (id: string) => data.suppliers.find((s) => s.id === id)?.name ?? id;
  const toggle = (id: string, key: EvKey) =>
    setEv((cur) => ({ ...cur, [id]: { ...cur[id]!, [key]: cur[id]![key] === true ? null : true } }));
  const reset = () => { setBudget(2000); setPriority("price"); setEv(data.seed.evidence); };

  return (
    <div className="lx-pg">
      <div className="lx-pg-ctl">
        <label className="lx-ctl">
          <span className="lx-ctl-h">Budget <b>{usd(budget)}</b></span>
          <input type="range" min={1500} max={2400} step={10} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label="Budget" />
        </label>
        <div className="lx-ctl">
          <span className="lx-ctl-h">Prefer</span>
          <div className="lx-seg" role="group" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button key={p.id} className={priority === p.id ? "on" : ""} onClick={() => setPriority(p.id)}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="lx-ctl">
          <span className="lx-ctl-h">Evidence <em>click to verify or drop it</em></span>
          <div className="lx-ev">
            {data.suppliers.map((s) => (
              <div key={s.id} className="lx-ev-row">
                <span>{s.name}</span>
                <div>
                  {EV.map((e) => {
                    const on = ev[s.id]![e.key] === true;
                    return <button key={e.key} className={`lx-chip ${on ? "ok" : "unk"}`} onClick={() => toggle(s.id, e.key)} aria-pressed={on}>{on ? "✓" : "?"} {e.label}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <button className="lx-btn sm" onClick={reset}>Reset</button>
      </div>

      <div className="lx-pg-out" aria-live="polite">
        {rows.map((r) => {
          const rec = r.quoteId === result.recommendedQuoteId;
          return (
            <div key={r.quoteId} className={`lx-row ${rec ? "rec" : ""} ${r.verdict}`}>
              <div className="lx-row-top">
                <b>{nameOf(r.supplierId)}</b>
                <span className="lx-price">{usd(r.totalCost)}</span>
              </div>
              <div className="lx-row-sub">
                <span className={`lx-verdict ${r.verdict}`}>{rec ? "recommended" : r.verdict === "eligible" ? `eligible · rank ${r.rank}` : r.verdict === "review_required" ? "held for review" : "ineligible"}</span>
                <span>{r.deliveryDays ? `${r.deliveryDays} days` : "delivery not stated"}</span>
              </div>
              {r.eligibility.reasons.length ? <div className="lx-row-why">{r.eligibility.reasons.map(reasonText).join(" · ")}</div> : null}
            </div>
          );
        })}
        <p className="lx-note">
          {result.recommendedQuoteId
            ? `Recommended: ${nameOf(result.rows.find((r) => r.quoteId === result.recommendedQuoteId)!.supplierId)}.${result.estimatedSavings ? ` Estimated saving ${usd(result.estimatedSavings.amount)} against the highest eligible quote.` : ""}`
            : "Nothing is eligible, so nothing is recommended. The engine never picks the least bad option for you."}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attack the agent: each button feeds the real execution gate a lie.  */
/* ------------------------------------------------------------------ */

interface Attack { id: string; label: string; hint: string }
const ATTACKS: Attack[] = [
  { id: "honest", label: "Pay as approved", hint: "The control: nothing is wrong." },
  { id: "redirect", label: "Redirect the money", hint: "Swap in a different payout address." },
  { id: "edit", label: "Edit the order", hint: "Raise a unit price after approval." },
  { id: "overspend", label: "Overspend", hint: "Pay more than the session allows." },
  { id: "expired", label: "Use an old session", hint: "The session timed out a minute ago." },
  { id: "twice", label: "Pay twice", hint: "Send the same order again." },
  { id: "skip", label: "Skip the human", hint: "No one has approved it." },
  { id: "restricted", label: "Pay a restricted supplier", hint: "Same order, blocked payee." },
  { id: "asset", label: "Switch currency", hint: "Pay in an unsupported asset." },
];

interface Verdict { attack: Attack; allowed: boolean; rejections: ExecutionRejection[]; amount: string; hashes?: { approved: string; current: string } }

function Attacks({ data }: { data: LandingData }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const { order } = data;

  const fingerprintInput = useMemo(() => ({
    supplierId: data.recommendedId, currency: "USD", paymentAsset: PAYMENT_ASSET, recipientAddress: order.recipient,
    subtotal: order.subtotal, deliveryCost: order.delivery, totalAmount: order.total, items: order.lines,
  }), [data, order]);

  async function run(attack: Attack) {
    setBusy(true);
    const now = new Date();
    const approved = await sha256(canonicalOrder(fingerprintInput));
    const base: ExecutionInput = {
      now, amount: money(order.total, PAYMENT_ASSET), recipientAddress: order.recipient, approvedRecipientAddress: order.recipient,
      supplierRestricted: false,
      session: { status: "active", asset: PAYMENT_ASSET, remainingAmount: data.session.budget, maxPerTransaction: data.session.perTransaction, expiresAt: new Date(now.getTime() + data.session.minutes * 60_000) },
      userApprovalRecorded: true, approvedOrderFingerprint: approved, currentOrderFingerprint: approved, paymentAlreadyExecuted: false,
      supportedAssets: [PAYMENT_ASSET],
      orderPolicy: { allowed: true, requiresApproval: true, reasonCodes: ["WITHIN_BUSINESS_BUDGET"], maxAllowedAmount: data.session.budget, currency: "USD" },
    };
    let input = base, hashes: Verdict["hashes"];
    switch (attack.id) {
      case "redirect": input = { ...base, recipientAddress: "0x000000000000000000000000000000000000dEaD" }; break;
      case "edit": {
        const lines = order.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: add(money(l.unitPrice, "USD"), money("0.01", "USD")).amount } : l));
        const current = await sha256(canonicalOrder({ ...fingerprintInput, items: lines }));
        input = { ...base, currentOrderFingerprint: current };
        hashes = { approved, current };
        break;
      }
      case "overspend": input = { ...base, amount: money("2600.00", PAYMENT_ASSET) }; break;
      case "expired": input = { ...base, session: { ...base.session!, expiresAt: new Date(now.getTime() - 60_000) } }; break;
      case "twice": input = { ...base, paymentAlreadyExecuted: true }; break;
      case "skip": input = { ...base, userApprovalRecorded: false }; break;
      case "restricted": input = { ...base, supplierRestricted: true }; break;
      case "asset": input = { ...base, amount: money(order.total, "USDT") }; break;
    }
    const d = evaluatePaymentExecution(input);
    setVerdict({ attack, allowed: d.allowed, rejections: d.rejections, hashes, amount: input.amount.amount });
    setBusy(false);
  }

  return (
    <div className="lx-atk">
      <div className="lx-atk-grid" role="group" aria-label="Attacks on the payment gate">
        {ATTACKS.map((a) => (
          <button key={a.id} className={`lx-atk-b ${verdict?.attack.id === a.id ? "on" : ""} ${a.id === "honest" ? "ctl" : ""}`} disabled={busy} onClick={() => void run(a)}>
            <b>{a.label}</b><span>{a.hint}</span>
          </button>
        ))}
      </div>
      <div className={`lx-atk-out ${verdict ? (verdict.allowed ? "ok" : "no") : ""}`} aria-live="polite">
        {verdict ? (
          <>
            <div className="lx-atk-head">
              <span className="lx-atk-stamp">{verdict.allowed ? "Allowed" : "Blocked"}</span>
              <span className="lx-atk-what">{verdict.attack.label} · {usd(verdict.amount)} to {order.recipient.slice(0, 8)}…</span>
            </div>
            {verdict.allowed ? <p className="lx-note">Every restriction held, so the payment may proceed to the network.</p> : (
              <ul className="lx-atk-list">{verdict.rejections.map((r) => <li key={r}><code>{r}</code>{REJECTION_TEXT[r]}</li>)}</ul>
            )}
            {verdict.hashes ? (
              <div className="lx-hash">
                <div><i>approved</i><code>{verdict.hashes.approved.slice(0, 32)}…</code></div>
                <div><i>now</i><code className="bad">{verdict.hashes.current.slice(0, 32)}…</code></div>
                <p>SHA-256 of the order, computed in your browser. One cent changed, a different fingerprint, approval void.</p>
              </div>
            ) : null}
          </>
        ) : <p className="lx-note">Pick an attack. Each one asks the real payment gate to do something it should refuse.</p>}
      </div>
    </div>
  );
}

export function Playground({ data }: { data: LandingData }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <section className="lx-sec" id="playground" aria-label="Break it yourself">
      <div className="lx-sec-in">
        <div className="lx-kicker">Break it yourself</div>
        <h2 className="lx-h">Change the facts. Watch the engine hold.</h2>
        <p className="lx-body">These are not mock-ups. The same deterministic code that runs on the server is running in this tab. Drop a supplier&apos;s evidence, shrink the budget, then try to fool the payment gate.</p>

        <h3 className="lx-sub"><span>A</span>Comparison</h3>
        {ready ? <Compare data={data} /> : <div className="lx-skel" />}

        <h3 className="lx-sub"><span>B</span>Attack the agent</h3>
        {ready ? <Attacks data={data} /> : <div className="lx-skel" />}
      </div>
    </section>
  );
}
