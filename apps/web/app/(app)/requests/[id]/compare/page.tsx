"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentExplain } from "@/components/agent-explain";
import { Icon } from "@/components/icon";
import { Modal, useToast } from "@/components/overlays";
import { Async, DemoTag, EmptyState, PageHead, Pill, SupplierLogo } from "@/components/ui";
import type { ComparisonView } from "@/lib/dto";
import { amount, minus, moneyShort } from "@/lib/format";
import { errorCode, errorDetails, errorMessage, useComparison, useCreateOrder, useOrders, useRequest, useStartSourcing } from "@/lib/queries";
import { EVIDENCE_CHECKS, reasonText } from "@/lib/reasons";
import { toUnits } from "@procura/shared";

type Row = ComparisonView["comparison"]["rows"][number];

export default function ComparePage() {
  const { id } = useParams<{ id: string }>();
  const request = useRequest(id);
  const comparison = useComparison(id);
  const orders = useOrders();
  const router = useRouter();
  const { show } = useToast();
  const sourcing = useStartSourcing();
  const createOrder = useCreateOrder();

  const [selected, setSelected] = useState<Row | null>(null);
  const [ack, setAck] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRevealed(true), 60); return () => clearTimeout(t); }, []);

  async function runSourcing() {
    const fromAmazon = comparison.data?.suppliers.some((s) => s.sourceType === "marketplace");
    try { await sourcing.mutateAsync({ id, source: fromAmazon ? "amazon" : "demo" }); show("Sourcing complete"); } catch (e) { show(errorMessage(e), "err"); }
  }

  async function confirm() {
    if (!selected) return;
    try {
      const order = await createOrder.mutateAsync({ requestId: id, quotationId: selected.quoteId, acknowledgeReview: ack });
      setSelected(null);
      show(`${order.orderNumber} created. It now needs your approval.`);
      router.push(`/orders/${order.id}`);
    } catch (e) {
      const details = errorDetails(e) as { reasonCodes?: string[]; reasons?: string[] } | undefined;
      const extra = errorCode(e) === "POLICY_REJECTED" && details?.reasonCodes ? ` ${details.reasonCodes.filter((c) => /EXCEEDS|NOT_|RESTRICTED/.test(c)).map(reasonText).join(" ")}` : "";
      setSelected(null);
      show(errorMessage(e) + extra, "err");
    }
  }

  return (
    <>
      <PageHead
        eyebrow={request.data ? <>{request.data.requestNumber} · {request.data.title}</> : undefined}
        title="Supplier comparison"
        sub="Compare available suppliers and choose the best purchasing option."
        actions={<Link href={`/requests/${id}`} className="btn btn-sec btn-sm"><Icon name="prev" /> Back to workspace</Link>}
      />
      <Async query={comparison}>
        {(view) => {
          const cmp = view.comparison;
          const name = (sid: string) => view.suppliers.find((s) => s.id === sid)?.name ?? "Supplier";
          const source = (sid: string) => view.suppliers.find((s) => s.id === sid)?.sourceType;
          const rec = cmp.rows.find((r) => r.quoteId === cmp.recommendedQuoteId);
          const openOrder = (orders.data ?? []).find((o) => o.requestId === id && o.status !== "cancelled" && o.status !== "failed");
          const canSelect = request.data?.status === "comparing" && !openOrder;

          if (cmp.rows.length === 0) {
            return (
              <div className="card">
                <EmptyState icon="search" title="No quotations yet"
                  action={<button className="btn btn-pri" disabled={sourcing.isPending} onClick={() => void runSourcing()}><Icon name="bolt" /> {sourcing.isPending ? "Sourcing…" : "Start sourcing"}</button>}>
                  Procura has not collected any quotes for this request. Amazon search needs a clear product name and USD, and the demo suppliers only cover rice, vegetable oil and frozen chicken.
                </EmptyState>
              </div>
            );
          }

          return (
            <>
              {openOrder ? (
                <div className="callout ok" style={{ marginBottom: 18 }}>
                  <Icon name="check" />
                  <div>{openOrder.orderNumber} has been prepared from this comparison. <Link className="linkbtn" href={`/orders/${openOrder.id}`}>View purchase order</Link></div>
                </div>
              ) : null}

              {rec ? (
                <div className="rec-banner" data-tour="rec-banner">
                  <div className="big"><Icon name="check" strokeWidth={3} /></div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <h2>{name(rec.supplierId)} is recommended {source(rec.supplierId) === "demo" ? <DemoTag /> : null}</h2>
                    <p>It has the lowest {source(rec.supplierId) === "marketplace" ? "listed price" : "total delivered price"} among the quotes that meet your requirements{view.evidence[rec.supplierId]?.historicalPerformanceAvailable ? ", and it has delivery history on record" : ""}. The ranking is computed from stored quotes and evidence, not guessed.</p>
                    <div className="rec-stats">
                      <div><div className="l">{source(rec.supplierId) === "marketplace" ? "Before shipping and tax" : "Total delivered"}</div><div className="v num">{moneyShort(rec.totalCost, cmp.currency)}</div></div>
                      <div><div className="l">Est. delivery</div><div className="v">{rec.deliveryDays ? `${rec.deliveryDays} days` : "Not stated"}</div></div>
                      {cmp.estimatedSavings ? <div><div className="l">Est. saving</div><div className="v num" style={{ color: "var(--ok)" }}>{moneyShort(cmp.estimatedSavings.amount, cmp.currency)}</div></div> : null}
                      {request.data ? <div><div className="l">Budget headroom</div><div className="v num">{moneyShort(minus(request.data.budgetAmount, rec.totalCost), cmp.currency)}</div></div> : null}
                    </div>
                    {cmp.estimatedSavings ? <p className="mut3" style={{ fontSize: 11.5, marginTop: 10 }}>{cmp.estimatedSavings.basis}</p> : null}
                  </div>
                  {canSelect ? (source(rec.supplierId) === "marketplace"
                    ? <button className="btn btn-pri" disabled title="Checkout through Kite Passport is the next step and is not built yet">Checkout comes next</button>
                    : <button className="btn btn-pri" onClick={() => { setAck(false); setSelected(rec); }}>Select and prepare PO <Icon name="arr" /></button>) : null}
                </div>
              ) : (
                <div className="callout warn" style={{ marginBottom: 18 }}>
                  <Icon name="alert" /><div>{cmp.notes.join(" ")}</div>
                </div>
              )}

              <AgentExplain requestId={id} hasEligible={cmp.rows.some((r) => r.verdict === "eligible")} />

              <div className="cmp-grid" id="cmpGrid">
                {cmp.rows.map((row, idx) => {
                  const ev = view.evidence[row.supplierId];
                  const isRec = row.quoteId === cmp.recommendedQuoteId;
                  return (
                    <div key={row.quoteId} className={`cmp-card ${isRec ? "rec" : ""} ${revealed ? "in" : ""}`}
                      style={{ transitionDelay: `${idx * 140}ms` }} data-tour={row.verdict === "review_required" ? "cmp-review" : undefined}>
                      {isRec ? <span className="cmp-rec-tag">RECOMMENDED</span> : null}
                      <div className="cmp-head">
                        <SupplierLogo name={name(row.supplierId)} size={36} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{name(row.supplierId)}</div>
                          <div className="mut3" style={{ fontSize: 11.5 }}>{source(row.supplierId) === "demo" ? "Demo supplier" : source(row.supplierId) === "marketplace" ? "Live Amazon listings" : "Supplier"}</div>
                        </div>
                      </div>
                      {(view.lines?.[row.quoteId] ?? []).some((l) => l.listing) ? (
                        <div className="cmp-items">
                          {(view.lines?.[row.quoteId] ?? []).map((l) => (
                            <div key={l.description} className="cmp-item">
                              <div className="ci-top"><b>{l.description}</b><span className="num">{Number(l.quantity)} × {moneyShort(l.unitPrice, row.currency)}</span></div>
                              {l.listing ? (
                                <div className="ci-sub">
                                  <a href={l.listing.link} target="_blank" rel="noopener noreferrer">{l.listing.title}</a>
                                  <span>{l.listing.rating !== null ? `${l.listing.rating}★` : "no rating"}{l.listing.reviews !== null ? ` · ${l.listing.reviews.toLocaleString("en-US")} reviews` : ""}</span>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="cmp-body">
                        <div className="cmp-line"><span className="mut">Est. delivery</span><span className="v">{row.deliveryDays ? `${row.deliveryDays} days` : "Not stated"}</span></div>
                        <div className="cmp-line"><span className="mut">Versus lowest</span><span className="v">{row.deltaVsLowest === null ? "-" : toUnits(row.deltaVsLowest) === 0n ? "Lowest" : `+${moneyShort(row.deltaVsLowest, row.currency)}`}</span></div>
                        <div className="cmp-line"><span className="mut">Verdict</span>
                          <span>{row.verdict === "eligible" ? <Pill tone="ok">Eligible</Pill> : row.verdict === "review_required" ? <Pill tone="warn">Review required</Pill> : <Pill tone="err">Not eligible</Pill>}</span></div>
                        <div className="cmp-line tot"><span>Total cost</span><span className="v">{moneyShort(row.totalCost, row.currency)}</span></div>
                      </div>
                      {row.eligibility.reasons.length > 0 || row.eligibility.concerns.length > 0 ? (
                        <div style={{ padding: "0 16px 14px", fontSize: 12, color: "var(--ink-2)" }}>
                          {row.eligibility.reasons.map((c) => <div key={c} style={{ display: "flex", gap: 7, marginTop: 4 }}><span style={{ color: row.verdict === "ineligible" ? "var(--err)" : "var(--warn)", flex: "none" }}>•</span>{reasonText(c)}</div>)}
                          {row.eligibility.concerns.filter((c) => !row.eligibility.reasons.some((rc) => reasonText(rc) === c)).map((c) => <div key={c} style={{ display: "flex", gap: 7, marginTop: 4 }}><span style={{ color: "var(--ink-3)", flex: "none" }}>•</span>{c}</div>)}
                        </div>
                      ) : null}
                      {ev ? (
                        <div className="ev-grid">
                          {EVIDENCE_CHECKS.filter((chk) => source(row.supplierId) !== "marketplace" || chk.key === "identityVerified" || chk.key === "quotationReceived").map((chk) => {
                            const v = ev[chk.key] as boolean | null;
                            const cls = v === true ? "ev-yes" : v === false && chk.key !== "historicalPerformanceAvailable" && chk.key !== "quotationReceived" ? "ev-fail" : "ev-no";
                            return <div key={chk.key} className={`ev-i ${cls}`}><Icon name={v === true ? "check" : "x"} strokeWidth={3} /><span>{v === true ? chk.ok : v === false && chk.key !== "historicalPerformanceAvailable" && chk.key !== "quotationReceived" ? chk.failed : chk.unknown}</span></div>;
                          })}
                        </div>
                      ) : null}
                      {source(row.supplierId) === "marketplace" ? (
                        <div className="mut3" style={{ padding: "0 16px 12px", fontSize: 11.5 }}>Paid through Amazon&apos;s checkout, so there is no supplier address to verify. Shipping and tax are added at checkout.</div>
                      ) : null}
                      <div className="cmp-foot">
                        <button className={`btn ${row.verdict === "eligible" ? "btn-pri" : "btn-sec"} btn-sm`} style={{ flex: 1 }}
                          disabled={!canSelect || row.verdict === "ineligible" || source(row.supplierId) === "marketplace"}
                          title={source(row.supplierId) === "marketplace" ? "Checkout through Kite Passport is the next step and is not built yet" : row.verdict === "ineligible" ? "This quote does not meet the requirements" : undefined}
                          onClick={() => { setAck(false); setSelected(row); }}>
                          {source(row.supplierId) === "marketplace" ? "Checkout comes next" : row.verdict === "review_required" ? "Review and select" : "Select"}
                        </button>
                        <Link href={`/sellers/${row.supplierId}`} className="btn btn-ghost btn-sm">Profile</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mut3" style={{ fontSize: 12 }}>All amounts include delivery and stated fees. Quotes in a different currency are never compared.</p>
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-ghost btn-sm" disabled={sourcing.isPending || !canSelect} onClick={() => void runSourcing()}><Icon name="search" /> {sourcing.isPending ? "Sourcing…" : "Re-run sourcing"}</button>
              </div>

              <Modal open={!!selected} onClose={() => setSelected(null)} label="Prepare purchase order">
                {selected ? (
                  <>
                    <div className="modal-body" style={{ textAlign: "left" }}>
                      <h3>Prepare a purchase order</h3>
                      <p>Procura will create a purchase order from {name(selected.supplierId)}&apos;s quotation. Every total is recalculated from unit prices on the server. Nothing is paid until you approve the order.</p>
                      <div className="modal-sum">
                        <div className="r"><span className="mut">Supplier</span><b>{name(selected.supplierId)}</b></div>
                        <div className="r"><span className="mut">Total delivered</span><b className="num">{amount(selected.totalCost)} {selected.currency}</b></div>
                        <div className="r"><span className="mut">Delivery</span><b>{selected.deliveryDays ? `${selected.deliveryDays} days` : "Not stated"}</b></div>
                      </div>
                      {selected.verdict === "review_required" ? (
                        <div className="callout warn" style={{ marginBottom: 12 }}>
                          <Icon name="alert" />
                          <div>
                            <b>This supplier needs review.</b>
                            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{selected.eligibility.reasons.map((c) => <li key={c}>{reasonText(c)}</li>)}</ul>
                            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
                              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
                              <span>I reviewed the missing evidence and want to continue. This is recorded in the audit log.</span>
                            </label>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="modal-foot">
                      <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => setSelected(null)}>Cancel</button>
                      <button className="btn btn-pri" style={{ flex: 1 }} disabled={createOrder.isPending || (selected.verdict === "review_required" && !ack)} onClick={() => void confirm()}>
                        {createOrder.isPending ? "Creating…" : "Create purchase order"}
                      </button>
                    </div>
                  </>
                ) : null}
              </Modal>
            </>
          );
        }}
      </Async>
    </>
  );
}
