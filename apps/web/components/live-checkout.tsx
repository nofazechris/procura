"use client";

import { useEffect, useMemo, useState } from "react";
import { amazonCheckoutLimits } from "@procura/policies/core";
import { Icon } from "@/components/icon";
import { Modal, useToast } from "@/components/overlays";
import { openBuyerPanel } from "@/lib/buyer-panels";
import { errorDetails, errorMessage, useLiveCheckout, useLivePlan } from "@/lib/queries";
import type { LiveReceiptDTO } from "@/lib/dto";

const trim = (a: string) => { const [i, f = ""] = a.split("."); const fr = f.replace(/0+$/, ""); return fr.length >= 1 ? `${i}.${fr.padEnd(2, "0")}` : `${i}.00`; };
const usd = (a: string) => `$${trim(a)}`;
const EMPTY = { name: "", email: "", phone: "", line1: "", line2: "", city: "", state: "", postal: "", country: "US" };

/**
 * Pays an approved Amazon order for real, from the Passport wallet. It shows exactly what will be held
 * and why, asks for the delivery details Amazon needs, and only pays after an explicit confirmation.
 */
export function LiveCheckoutDialog({ orderId, open, onClose }: { orderId: string; open: boolean; onClose: () => void }) {
  const plan = useLivePlan(orderId, open);
  const pay = useLiveCheckout(orderId);
  const { show } = useToast();
  const [ship, setShip] = useState(EMPTY);
  const [editShip, setEditShip] = useState(false);
  const [ceiling, setCeiling] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sure, setSure] = useState(false);
  const [receipt, setReceipt] = useState<LiveReceiptDTO | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const p = plan.data;

  useEffect(() => {
    if (!p) return;
    if (p.shipping) setShip({ name: p.shipping.name, email: p.shipping.email, phone: p.shipping.phone, line1: p.shipping.line1, line2: p.shipping.line2, city: p.shipping.city, state: p.shipping.state, postal: p.shipping.postalCode, country: p.shipping.country || "US" });
    setEditShip(!p.shipping?.complete);
    if (p.limits) setCeiling((c) => c || p.limits!.cap);
    setSessionId((s) => (s && p.sessions.some((x) => x.id === s) ? s : p.sessions[0]?.id ?? ""));
  }, [p]);

  const limits = useMemo(() => {
    if (!p) return null;
    try { return amazonCheckoutLimits(p.subtotal, ceiling || p.limits?.cap); } catch { return null; }
  }, [p, ceiling]);

  const walletShort = !!(p?.walletUsd && limits && Number(limits.charge) > Number(p.walletUsd));
  const blockers = [...(p?.blockers ?? []), ...(walletShort ? [`This holds ${usd(limits!.charge)} up front and your wallet has ${usd(p!.walletUsd!)}. Lower the ceiling or add funds.`] : [])];
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setShip((s) => ({ ...s, [k]: e.target.value }));

  async function go() {
    if (!limits || !sessionId) return;
    setProblem(null);
    try {
      const r = await pay.mutateAsync({
        sessionId, confirmed: true, maxTotal: limits.cap,
        ...(editShip ? { shipping: { name: ship.name, email: ship.email, phone: ship.phone, line1: ship.line1, ...(ship.line2 ? { line2: ship.line2 } : {}), city: ship.city, state: ship.state, postal: ship.postal, country: ship.country } } : {}),
      });
      setReceipt(r);
      show(r.status === "paid" ? "Order paid" : "Payment sent");
    } catch (e) {
      const rej = (errorDetails(e) as { rejections?: { message: string }[] } | undefined)?.rejections;
      setProblem(rej?.length ? rej.map((x) => x.message).join(" ") : errorMessage(e));
    }
  }

  const field = (k: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="fld" style={{ marginBottom: 0 }}><label htmlFor={`lc-${k}`}>{label}</label><input id={`lc-${k}`} className="input" value={ship[k]} onChange={set(k)} {...props} /></div>
  );

  return (
    <Modal open={open} onClose={() => { if (!pay.isPending) onClose(); }} label="Pay for this order" wide>
      <div style={{ padding: 24, display: "grid", gap: 16, maxHeight: "82vh", overflowY: "auto" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18 }}>Pay with Kite</h3>
          <p className="mut" style={{ fontSize: 12.5, margin: "4px 0 0" }}>This spends real money from your buyer&apos;s Kite Passport wallet, inside the spending session you approved.</p>
        </div>

        {receipt ? (
          <div className="callout ok"><Icon name="check" /><div>
            <b>{receipt.status === "paid" ? "Paid." : "Payment sent."}</b> {receipt.note}
            <div className="mut3" style={{ fontSize: 12, marginTop: 6 }}>Kite order {receipt.orderId} · held {usd(receipt.held)} up front, ceiling {usd(receipt.ceiling)}.</div>
            <div style={{ marginTop: 10 }}><button className="btn btn-sec btn-sm" onClick={onClose}>Done</button></div>
          </div></div>
        ) : plan.isLoading ? <p className="mut3" style={{ fontSize: 13 }}>Checking your wallet and the order… this can take about ten seconds.</p>
        : plan.isError ? <div className="callout err"><Icon name="alert" /><div>{errorMessage(plan.error)}</div></div>
        : p ? (
          <>
            <div className="modal-sum">
              {p.lines.map((l) => <div key={l.title + l.unitPrice} className="r"><span className="mut" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.quantity} × {l.title}</span><b className="num">{usd(l.unitPrice)}</b></div>)}
              <div className="r"><span className="mut">Items</span><b className="num">{usd(p.subtotal)}</b></div>
              <div className="r"><span className="mut">Your buyer&apos;s wallet</span><b className="num">{p.walletUsd ? usd(p.walletUsd) : "unknown"}</b></div>
            </div>

            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>What it holds</div>
              <div className="fld" style={{ marginBottom: 6 }}>
                <label htmlFor="lc-ceiling">Most the order may cost, with shipping and tax (USD)</label>
                <input id="lc-ceiling" className="input num" style={{ maxWidth: 180 }} inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} aria-invalid={!limits} />
              </div>
              {limits ? (
                <p className="mut" style={{ fontSize: 12.5, margin: 0 }}>
                  Up front it holds <b>{usd(limits.charge)}</b> ({usd(limits.cap)} ceiling plus a {usd(limits.fee)} Kite fee). What the order does not use is refunded to your buyer&apos;s wallet.
                  {p.tightened && p.limits ? " Your wallet is small, so the ceiling is as high as it can go." : null}
                </p>
              ) : <p className="ferr" style={{ fontSize: 12.5 }}>The ceiling cannot be lower than the price of the items ({usd(p.subtotal)}).</p>}
              <p className="mut3" style={{ fontSize: 12, margin: "6px 0 0" }}>If Amazon&apos;s shipping and tax push the total above the ceiling, Amazon refuses the order and everything is refunded.</p>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div className="eyebrow">Deliver to</div>
                {p.shipping?.complete ? <button className="linkbtn" onClick={() => setEditShip((v) => !v)}>{editShip ? "Use saved details" : "Change"}</button> : null}
              </div>
              {editShip ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="grid-2">{field("name", "Full name", { autoComplete: "name" })}{field("email", "Email", { type: "email", autoComplete: "email" })}</div>
                  <div className="grid-2">{field("phone", "Phone (digits)", { inputMode: "tel", autoComplete: "tel" })}{field("country", "Country (2 letters)", { maxLength: 2, style: { textTransform: "uppercase" } })}</div>
                  {field("line1", "Street address", { autoComplete: "address-line1" })}
                  {field("line2", "Apartment, suite (optional)", { autoComplete: "address-line2" })}
                  <div className="grid-2">{field("city", "City", { autoComplete: "address-level2" })}{field("state", "State or province", { autoComplete: "address-level1" })}</div>
                  <div style={{ maxWidth: 200 }}>{field("postal", "Postal or ZIP code", { autoComplete: "postal-code" })}</div>
                </div>
              ) : (
                <p style={{ fontSize: 13, margin: 0 }}>{p.shipping?.name}<br />{p.shipping?.line1}{p.shipping?.line2 ? `, ${p.shipping.line2}` : ""}<br />{p.shipping?.city}, {p.shipping?.state} {p.shipping?.postalCode}, {p.shipping?.country}</p>
              )}
            </div>

            {p.sessions.length > 1 ? (
              <div className="fld" style={{ marginBottom: 0 }}><label htmlFor="lc-session">Pay from session</label>
                <select id="lc-session" className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  {p.sessions.map((s) => <option key={s.id} value={s.id}>{usd(s.maxTotal)} total, {usd(s.maxPerTx)} a payment{s.expiresAt ? `, until ${new Date(s.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</option>)}
                </select></div>
            ) : null}

            {blockers.length ? (
              <div className="callout warn" role="alert"><Icon name="alert" /><div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button className="btn btn-sec btn-sm" onClick={() => { onClose(); openBuyerPanel("fund"); }}>Add funds</button>
                  <button className="btn btn-sec btn-sm" onClick={() => { onClose(); openBuyerPanel("session", limits ? { amount: limits.charge } : {}); }}>Request a spending session</button>
                </div>
              </div></div>
            ) : null}

            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I understand this spends real money from my buyer&apos;s wallet and cannot be recalled once it is sent.</span>
            </label>
            {problem ? <div className="callout err" role="alert"><Icon name="alert" /><div>{problem}</div></div> : null}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-sec" onClick={onClose} disabled={pay.isPending}>Cancel</button>
              <button className="btn btn-pri" disabled={!sure || !limits || !sessionId || blockers.length > 0 || pay.isPending} onClick={() => void go()}>
                <Icon name="card" /> {pay.isPending ? "Paying… this can take a minute" : limits ? `Pay ${usd(limits.charge)} now` : "Pay now"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
