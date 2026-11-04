"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { Drawer } from "@/components/overlays";
import { PaymentDetailBody } from "@/components/payment-detail";
import { Async, EmptyState, Kpi, PageHead, PaymentStatusPill } from "@/components/ui";
import { useApp } from "@/lib/app-context";
import type { PaymentDTO } from "@/lib/dto";
import { amount, moneyShort, shortAddress, shortDate } from "@/lib/format";
import { usePayments } from "@/lib/queries";
import { sum } from "@procura/shared";

export default function PaymentsPage() {
  const { mode } = useApp();
  const payments = usePayments();
  const [open, setOpen] = useState<PaymentDTO | null>(null);

  return (
    <>
      <PageHead title="Payments" sub="Every payment your buyer has made, and what it cost." />
      <Async query={payments}>
        {(rows) => {
          const asset = rows[0]?.asset ?? "USDC.e";
          const total = (status: string[]) => sum(rows.filter((r) => status.includes(r.status) && r.asset === asset).map((r) => ({ amount: r.amount, currency: asset })), asset).amount;
          const failed = rows.filter((r) => r.status === "failed").length;
          return (
            <>
              <div className="kpis">
                <Kpi label="Total paid" icon="card" tone={rows.some((r) => r.status === "confirmed") ? "up" : undefined} value={moneyShort(total(["confirmed"]), asset)} sub="confirmed on the network" />
                <Kpi label="Pending" icon="clock" value={moneyShort(total(["prepared", "awaiting_authorisation", "authorised", "submitted", "pending"]), asset)} sub="not yet confirmed" />
                <Kpi label="Failed" icon="shield" value={failed} sub={failed ? "need attention" : "no failed transactions"} />
                <Kpi label="Transactions" icon="trend" value={rows.length} sub={rows.length ? `all on ${rows[0]!.network}` : "none yet"} />
              </div>
              {rows.length === 0 ? (
                <div className="card"><EmptyState icon="card" title="No payments yet">
                  {mode === "live" ? "Payments appear here once Kite Passport is connected and you approve a spending session. Nothing has been paid." : "Approve the sample order to see a payment here."}
                </EmptyState></div>
              ) : (
                <div className="tbl-wrap" data-tour="payments-table">
                  <table className="tbl">
                    <thead><tr><th>Transaction</th><th>Seller</th><th>Order</th><th>Amount</th><th>Network</th><th>Status</th><th>Date</th></tr></thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id} className="row-link" onClick={() => setOpen(p)}>
                          <td className="r-id" style={{ fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{p.transactionHash ? shortAddress(p.transactionHash) : "Not submitted"}</td>
                          <td><b>{p.supplierName}</b></td>
                          <td className="mut">{p.orderNumber}</td>
                          <td className="num">{amount(p.amount)} {p.asset}</td>
                          <td><span className="chip" style={{ fontSize: 11, padding: "3px 9px" }}>{p.network}</span></td>
                          <td><PaymentStatusPill status={p.status} /></td>
                          <td className="mut num">{shortDate(p.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mut3" style={{ fontSize: 12, marginTop: 14, display: "flex", alignItems: "center", gap: 7 }}>
                <Icon name="shield" /> Payment states reflect actual provider or chain responses. A payment is confirmed only after the network confirms it.
              </p>
            </>
          );
        }}
      </Async>
      <Drawer open={!!open} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <div className="drawer-head">
              <div><div className="eyebrow">Payment</div><div style={{ fontWeight: 700, fontSize: 15, marginTop: 3, fontFamily: "ui-monospace,monospace" }}>{open.transactionHash ? shortAddress(open.transactionHash) : open.id.slice(0, 8)}</div></div>
              <button className="icon-btn" aria-label="Close" onClick={() => setOpen(null)}><Icon name="x" /></button>
            </div>
            <div className="drawer-body"><PaymentDetailBody p={open} demo={mode === "demo"} /></div>
            <div className="drawer-foot"><Link href={`/payments/${open.id}`} className="btn btn-sec" style={{ flex: 1 }}>Open full page <Icon name="arr" /></Link></div>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
