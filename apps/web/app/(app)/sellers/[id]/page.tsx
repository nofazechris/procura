"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/overlays";
import { Async, DemoTag, EmptyState, OrderStatusPill, PageHead, Pill, SupplierLogo } from "@/components/ui";
import { useCan } from "@/lib/app-context";
import { moneyShort, shortAddress, shortDate } from "@/lib/format";
import { errorMessage, useApprovePayout, useOrders, useSupplier } from "@/lib/queries";
import { EVIDENCE_CHECKS } from "@/lib/reasons";
import { totalOf, spentOrders } from "@/lib/derive";
import { SupplierStatePill, supplierState } from "@/components/supplier-state";
import { CallPanel } from "@/components/call-panel";
import { VerifyPanel } from "@/components/verify-panel";

function Stat({ v, l }: { v: string | number; l: string }) {
  return <div className="stat"><div className="sv num">{v}</div><div className="sl">{l}</div></div>;
}

function InfoRow({ label, value, tag }: { label: string; value: string; tag?: "Verified" | "Supplier provided" | "Not verified" }) {
  return (
    <div className="spec-row"><span className="mut">{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {tag ? <span className={`pill ${tag === "Verified" ? "p-ok" : tag === "Supplier provided" ? "p-mute" : "p-warn"}`} style={{ fontSize: 10 }}>{tag}</span> : null}
        <span className="v">{value}</span>
      </span>
    </div>
  );
}

export default function SupplierProfilePage() {
  const { id } = useParams<{ id: string }>();
  const query = useSupplier(id);
  const orders = useOrders();
  const router = useRouter();
  const { show } = useToast();
  const approve = useApprovePayout();
  const canApprove = useCan("approvals:decide");
  const canSpend = useCan("passport:manage");

  return (
    <Async query={query}>
      {(d) => {
        const s = d.supplier;
        const ev = d.evidenceSummary;
        const mine = (orders.data ?? []).filter((o) => o.supplierId === id);
        const spend = totalOf(spentOrders(mine, "USD"), "USD");
        const state = supplierState({ ...s, evidenceSummary: ev });
        return (
          <>
            <PageHead
              eyebrow="Seller"
              title={<span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}><SupplierLogo name={s.name} size={46} />{s.name}</span>}
              sub={[[s.city, s.countryCode].filter(Boolean).join(", "), s.categories.join(" · ")].filter(Boolean).join(" · ")}
              actions={<>
                <Link href="/sellers" className="btn btn-sec btn-sm"><Icon name="prev" /> All sellers</Link>
                <Link href="/requests/new" className="btn btn-pri"><Icon name="plus" /> New request</Link>
              </>}
            />
            <div style={{ marginBottom: 20, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <SupplierStatePill state={state} />
              {s.sourceType === "demo" ? <DemoTag>Demo seller, fictional</DemoTag> : null}
            </div>

            <div className="stat-strip">
              <Stat v={d.quotations.length} l="Quotes received" />
              <Stat v={mine.length} l="Orders placed" />
              <Stat v={mine.length ? moneyShort(spend, "USD") : "$0"} l="Total paid" />
              <Stat v={d.quotations[0] ? shortDate(d.quotations[0].createdAt) : "-"} l="Latest quote" />
            </div>

            <div className="grid-main">
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div className="card" style={{ padding: 20 }}>
                  <div className="sec-head"><h2>About this seller</h2></div>
                  <InfoRow label="Legal name" value={s.legalName ?? s.name} tag={ev.identityVerified ? "Verified" : "Not verified"} />
                  <InfoRow label="Location" value={[s.city, s.countryCode].filter(Boolean).join(", ") || "Not provided"} tag="Supplier provided" />
                  <InfoRow label="Phone" value={s.phone ?? "Not provided"} {...(s.phone ? { tag: ev.contactVerified ? "Verified" as const : "Supplier provided" as const } : {})} />
                  <InfoRow label="Email" value={s.email ?? "Not provided"} {...(s.email ? { tag: ev.contactVerified ? "Verified" as const : "Supplier provided" as const } : {})} />
                  <InfoRow label="Categories" value={s.categories.join(", ") || "Not provided"} tag="Supplier provided" />
                </div>

                <div className="card" style={{ padding: 20 }}>
                  <div className="sec-head"><h2>Payment addresses</h2></div>
                  <p className="mut" style={{ fontSize: 12.5, marginBottom: 12 }}>Procura can only pay an address a person has approved. The agent can propose one but never approve it.</p>
                  {d.payoutDestinations.length === 0 ? <p className="mut3" style={{ fontSize: 13 }}>No payment address on record.</p> : d.payoutDestinations.map((p) => (
                    <div key={p.id} className="recipient-box" style={{ margin: "0 0 10px" }}>
                      <span className="k-ic" style={{ background: "var(--surface)", color: "var(--forest-2)" }}><Icon name="wallet" /></span>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{p.network} · {p.asset}</div>
                        <div className="addr" title={p.address}>{shortAddress(p.address)}</div>
                      </div>
                      {p.status === "approved" ? <Pill tone="ok">Approved</Pill> : p.status === "revoked" ? <Pill tone="mute">Revoked</Pill> : (
                        <>
                          <Pill tone="warn">Awaiting approval</Pill>
                          {canApprove ? (
                            <button className="btn btn-sec btn-sm" disabled={approve.isPending} onClick={async () => {
                              try { await approve.mutateAsync({ supplierId: id, destinationId: p.id }); show("Payment address approved"); } catch (e) { show(errorMessage(e), "err"); }
                            }}>Approve</button>
                          ) : null}
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="card" style={{ padding: 20 }}>
                  <div className="sec-head"><h2>Quotations</h2></div>
                  {d.quotations.length === 0 ? <EmptyState icon="doc" title="No quotations">Quotes appear here when this supplier is asked to quote.</EmptyState> : (
                    <div className="tbl-wrap" style={{ border: "none", boxShadow: "none" }}>
                      <table className="tbl">
                        <thead><tr><th>Reference</th><th>Total</th><th>Delivery</th><th>Status</th><th>Date</th></tr></thead>
                        <tbody>
                          {d.quotations.map((q) => (
                            <tr key={q.id} className="row-link" onClick={() => router.push(`/requests/${q.requestId}/compare`)}>
                              <td className="r-id">{q.supplierQuoteReference ?? q.id.slice(0, 8)}</td>
                              <td className="num">{moneyShort(q.totalCost, q.currency)}</td>
                              <td className="mut num">{q.estimatedDeliveryDays ? `${q.estimatedDeliveryDays} days` : "-"}</td>
                              <td><Pill tone={q.quoteStatus === "selected" ? "ok" : q.quoteStatus === "received" ? "info" : "mute"}>{q.quoteStatus[0]!.toUpperCase() + q.quoteStatus.slice(1)}</Pill></td>
                              <td className="mut num">{shortDate(q.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="card" style={{ padding: 20 }}>
                  <div className="sec-head"><h2>Orders</h2></div>
                  {mine.length === 0 ? <p className="mut3" style={{ fontSize: 13 }}>No orders with this seller yet.</p> : (
                    <div className="tbl-wrap" style={{ border: "none", boxShadow: "none" }}>
                      <table className="tbl"><thead><tr><th>PO</th><th>Request</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
                        <tbody>{mine.map((o) => (
                          <tr key={o.id} className="row-link" onClick={() => router.push(`/orders/${o.id}`)}>
                            <td className="r-id">{o.orderNumber}</td><td className="mut">{o.requestTitle}</td><td className="num">{moneyShort(o.totalAmount, o.currency)}</td>
                            <td><OrderStatusPill status={o.status} /></td><td className="mut num">{shortDate(o.createdAt)}</td>
                          </tr>))}</tbody></table>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {s.sourceType === "demo" || s.sourceType === "marketplace" ? null : <><VerifyPanel supplierId={id} canSpend={canSpend} /><CallPanel supplierId={id} /></>}
                <div className="card" style={{ padding: 20 }}>
                  <div className="sec-head"><h2>Verification evidence</h2></div>
                  {EVIDENCE_CHECKS.map((chk) => {
                    const v = ev[chk.key] as boolean | null;
                    return (
                      <div key={chk.key} className="ev-row">
                        <div className={`ev-ic ${v === true ? "yes" : "no"}`}><Icon name={v === true ? "check" : "x"} strokeWidth={3} /></div>
                        <div style={{ flex: 1 }}><div className="et">{v === true ? chk.ok : v === false && chk.key !== "historicalPerformanceAvailable" && chk.key !== "quotationReceived" ? chk.failed : chk.unknown}</div>
                          <div className="es">{v === true ? "Evidence on file" : "Not verified. Unknown is never treated as passed."}</div></div>
                      </div>
                    );
                  })}
                  <p className="mut3" style={{ fontSize: 11.5, marginTop: 10 }}>Procura never marks a supplier verified on model confidence alone. Each item reflects evidence actually on file.</p>
                </div>
                <div className="card" style={{ padding: 20 }}>
                  <div className="sec-head"><h2>Risk observations</h2></div>
                  {ev.unresolvedConcerns.length === 0 ? (
                    <div className="insight" style={{ marginBottom: 0 }}><div className="ic" style={{ color: "var(--ok)" }}><Icon name="check" /></div><p>No unresolved concerns on record.</p></div>
                  ) : ev.unresolvedConcerns.map((c) => (
                    <div key={c} className="insight"><div className="ic" style={{ color: "var(--warn)" }}><Icon name="alert" /></div><p>{c}.</p></div>
                  ))}
                </div>
                <div className="card" style={{ padding: 20 }}>
                  <div className="sec-head"><h2>Evidence sources</h2></div>
                  {d.evidence.length === 0 ? <p className="mut3" style={{ fontSize: 13 }}>No evidence collected yet.</p> : d.evidence.map((e) => (
                    <div key={e.id} className="vtl-i on"><span className="nd" /><div className="vt">{e.evidenceType.replace(/_/g, " ")}</div><div className="vs">{e.sourceName} · {e.verificationStatus} · {shortDate(e.collectedAt)}</div>{typeof e.evidenceData?.summary === "string" ? <div className="vs" style={{ marginTop: 2 }}>{e.evidenceData.summary}</div> : null}</div>
                  ))}
                </div>
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}

