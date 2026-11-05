"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ApproveOrderModal, DestinationPill } from "@/components/approve-order";
import { Icon } from "@/components/icon";
import { Modal, useToast } from "@/components/overlays";
import { Async, DemoTag, OrderStatusPill, PageHead, Pill, SpecRow } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import { amazonCheckoutLimits, settleCheckout } from "@procura/policies/core";
import { amount, dateTime, money, shortAddress, shortDate } from "@/lib/format";
import { downloadBytes, purchaseOrderPdf } from "@/lib/pdf";
import { errorDetails, errorMessage, useCheckout, useOrder, useRejectOrder } from "@/lib/queries";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useOrder(id);
  const { mode } = useApp();
  const { show } = useToast();
  const reject = useRejectOrder();
  const checkout = useCheckout();
  const canDecide = useCan("approvals:decide");
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  return (
    <Async query={query}>
      {(d) => {
        const o = d.order;
        const paid = ["paid", "processing", "fulfilled"].includes(o.status);
        const pending = o.status === "pending_approval";
        const marketplace = d.supplier?.sourceType === "marketplace";
        const practice = (d.payments ?? []).find((p) => p.network === "simulation" && p.status === "confirmed") ?? null;
        const limits = marketplace && o.currency === "USD" ? amazonCheckoutLimits(o.subtotal) : null;
        const settlement = limits ? settleCheckout(limits, o.totalAmount) : null;
        const runCheckout = async () => {
          try { await checkout.mutateAsync(o.id); show("Practice checkout recorded. Nothing was charged."); }
          catch (e) {
            const rej = (errorDetails(e) as { rejections?: { code: string; message: string }[] } | undefined)?.rejections;
            show(rej?.length ? rej.map((r) => r.message).join(" ") : errorMessage(e), "err");
          }
        };
        const timeline = [
          { t: "Order created", s: dateTime(o.createdAt), on: true },
          { t: "Approved by a person", s: o.approvedAt ? dateTime(o.approvedAt) : "Waiting", on: !!o.approvedAt },
          { t: practice ? "Practice payment recorded" : "Payment confirmed", s: practice ? `Reference ${practice.reference ?? ""} · nothing was charged` : paid ? "Confirmed on the network" : "Needs a funded Kite Passport session", on: paid || !!practice },
          { t: "Delivered", s: o.status === "fulfilled" ? "Fulfilled" : "Not yet", on: o.status === "fulfilled" },
        ];
        return (
          <>
            <PageHead
              eyebrow={<>Order {mode === "demo" ? <DemoTag>Demo</DemoTag> : null}</>}
              title={o.orderNumber}
              sub={d.request ? <>{d.request.title} · <Link className="linkbtn" href={`/requests/${d.request.id}`}>{d.request.requestNumber}</Link></> : undefined}
              actions={<>
                <Link href="/orders" className="btn btn-sec btn-sm"><Icon name="prev" /> All orders</Link>
                <button className="btn btn-sec" onClick={() => { downloadBytes(`${o.orderNumber}.pdf`, purchaseOrderPdf(d)); show(`${o.orderNumber}.pdf downloaded`); }}><Icon name="doc" /> Export PDF</button>
                {pending && canDecide ? <button className="btn btn-pri" onClick={() => setApproving(true)}><Icon name="shield" /> Review and approve</button> : null}
              </>}
            />

            <div className="card po-doc">
              <div className="po-head">
                <div><div className="eyebrow">Status</div><div style={{ marginTop: 7 }}><OrderStatusPill status={o.status} /></div></div>
                <div style={{ textAlign: "right" }}>
                  <div className="eyebrow">Total</div>
                  <div className="num" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{money(o.totalAmount, o.currency)}</div>
                  <div className="mut3" style={{ fontSize: 12 }}>Payable as {amount(o.paymentAmount)} {o.paymentAsset} · issued {shortDate(o.createdAt)}</div>
                </div>
              </div>

              <div className="po-parties">
                <div className="po-party"><div className="pl">Buyer</div><div className="pn">{d.business?.name}</div><div className="pa">{d.business?.address ?? "Address not set"}</div></div>
                <div className="po-party">
                  <div className="pl">Seller</div>
                  <div className="pn">{d.supplier ? <Link href={`/sellers/${d.supplier.id}`} style={{ textDecoration: "none" }}>{d.supplier.name}</Link> : "Supplier"} {d.supplier?.sourceType === "demo" ? <DemoTag>Demo</DemoTag> : null}</div>
                  <div className="pa">{[d.supplier?.city, d.supplier?.countryCode].filter(Boolean).join(", ")}<br />
                    {marketplace ? <>Paid at Amazon checkout <Pill tone="info">Marketplace</Pill></> : <>{d.destination ? <>Pays to <span style={{ fontFamily: "ui-monospace,monospace" }} title={d.destination.address}>{shortAddress(d.destination.address)}</span> </> : "No payment address "}
                    <DestinationPill d={d.destination} /></>}</div>
                </div>
              </div>

              <div className="po-items">
                <table className="tbl">
                  <thead><tr><th>Item</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Unit price</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                  <tbody>
                    {d.items.map((it) => (
                      <tr key={it.id} style={{ cursor: "default" }}>
                        <td><b>{it.description}</b></td>
                        <td className="num" style={{ textAlign: "right" }}>{amount(it.quantity, 0)}</td>
                        <td className="num" style={{ textAlign: "right" }}>{amount(it.unitPrice)}</td>
                        <td className="num" style={{ textAlign: "right" }}>{amount(it.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "10px 0 2px" }}>
                <div className="po-total-row"><span className="mut">Subtotal</span><span className="num">{money(o.subtotal, o.currency)}</span></div>
                <div className="po-total-row"><span className="mut">Delivery</span><span className="num">{money(o.deliveryCost, o.currency)}</span></div>
                <div className="po-total-row grand"><span>Total</span><span className="num">{money(o.totalAmount, o.currency)}</span></div>
              </div>

              <div className="po-section">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Terms</div>
                <div className="two-col">
                  <SpecRow label="Delivery terms" value={o.deliveryTerms ?? "-"} />
                  <SpecRow label="Payment conditions" value={o.paymentTerms ?? "-"} />
                  <SpecRow label="Currency" value={o.currency} />
                  <SpecRow label="Payment asset" value={o.paymentAsset} />
                </div>
              </div>

              <div className="po-section">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Approval</div>
                {d.approvals.length === 0 ? <p className="mut3" style={{ fontSize: 13 }}>No approval record.</p> : d.approvals.map((a) => (
                  <div key={a.id} className="feed-i">
                    <div className="feed-dot" style={a.status === "approved" ? { background: "var(--ok-bg)", color: "var(--ok)" } : undefined}><Icon name={a.status === "approved" ? "shield" : "clock"} /></div>
                    <div>
                      <div className="ft">{a.status === "approved" ? "Approved" : a.status === "rejected" ? "Rejected" : a.status === "expired" ? "Expired" : "Awaiting approval"}</div>
                      <div className="fs">{a.decidedAt ? dateTime(a.decidedAt) : a.expiresAt ? `Expires ${shortDate(a.expiresAt)}` : ""}{a.reason ? ` · ${a.reason}` : ""}</div>
                    </div>
                  </div>
                ))}
                {o.approvedFingerprint ? (
                  <p className="mut3" style={{ fontSize: 11.5, marginTop: 10 }}>
                    Approval fingerprint <span style={{ fontFamily: "ui-monospace,monospace" }}>{o.approvedFingerprint.slice(0, 16)}…</span>. If the amount, items or recipient change after approval, this no longer matches and payment is refused.
                  </p>
                ) : null}
              </div>

              <div className="po-section">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Progress</div>
                <div className="vtl">{timeline.map((s) => <div key={s.t} className={`vtl-i ${s.on ? "on" : ""}`}><span className="nd" /><div className="vt">{s.t}</div><div className="vs">{s.s}</div></div>)}</div>
                {practice ? (
                  <div className="callout ok" style={{ marginTop: 14 }}>
                    <Icon name="check" />
                    <div>
                      <b>Practice checkout complete.</b> The payment gate checked the order exactly as you approved it, then a practice payment <b>{practice.reference}</b> was
                      recorded. <b>Nothing was charged and nothing was ordered.</b>
                      {settlement && limits ? (
                        <div style={{ marginTop: 8, display: "grid", gap: 3, fontSize: 12.5 }}>
                          <span>Held up front: <b className="num">{money(settlement.held, "USD")}</b> (items plus a buffer of up to the cap {money(limits.cap, "USD")}, plus a {money(limits.fee, "USD")} fee)</span>
                          <span>Taken: <b className="num">{money(settlement.settled, "USD")}</b> (the order plus the fee)</span>
                          <span>Refunded: <b className="num">{money(settlement.refunded, "USD")}</b></span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : o.status === "approved" && mode === "live" ? (
                  <div className="callout info" style={{ marginTop: 14, alignItems: "flex-start" }}>
                    <Icon name="shield" />
                    <div>
                      <b>Practice checkout.</b> Real payment needs a funded Kite Passport session, and the wallet is empty, so this runs the full check without moving money.
                      {limits ? <> A real Amazon checkout would hold up to <b className="num">{money(limits.charge, "USD")}</b> ({money(limits.cap, "USD")} cap plus a {money(limits.fee, "USD")} fee) and refund what the order does not use.</> : null}
                      {canDecide ? (
                        <div style={{ marginTop: 10 }}>
                          <button className="btn btn-pri btn-sm" disabled={checkout.isPending} onClick={() => void runCheckout()}>
                            <Icon name="bolt" /> {checkout.isPending ? "Checking…" : "Run practice checkout"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : o.status === "approved" ? (
                  <div className="callout info" style={{ marginTop: 14 }}><Icon name="alert" /><div>In the demo, open Approvals to simulate the Passport payment.</div></div>
                ) : null}
              </div>
            </div>

            {pending && canDecide ? (
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--err)" }} onClick={() => setRejecting(true)}>Reject this order</button>
              </div>
            ) : null}

            <ApproveOrderModal open={approving} onClose={() => setApproving(false)}
              order={{
                id: o.id, orderNumber: o.orderNumber, supplierId: o.supplierId, supplierName: d.supplier?.name ?? "Supplier",
                total: o.totalAmount, currency: o.currency, paymentAsset: o.paymentAsset, paymentAmount: o.paymentAmount, destination: d.destination,
                marketplace,
              }} />

            <Modal open={rejecting} onClose={() => setRejecting(false)} label="Reject order">
              <div className="modal-body" style={{ textAlign: "left" }}>
                <h3>Reject {o.orderNumber}?</h3>
                <p>The order is cancelled and the request returns to comparison so you can choose another seller.</p>
              </div>
              <div className="modal-foot">
                <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => setRejecting(false)}>Keep it</button>
                <button className="btn btn-forest" style={{ flex: 1 }} disabled={reject.isPending} onClick={async () => {
                  try { await reject.mutateAsync({ id: o.id }); setRejecting(false); show(`${o.orderNumber} rejected`); } catch (e) { setRejecting(false); show(errorMessage(e), "err"); }
                }}>{reject.isPending ? "Rejecting…" : "Reject order"}</button>
              </div>
            </Modal>
          </>
        );
      }}
    </Async>
  );
}
