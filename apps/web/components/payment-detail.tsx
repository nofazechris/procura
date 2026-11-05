"use client";

import Link from "next/link";
import { Icon } from "./icon";
import { PaymentStatusPill } from "./ui";
import type { PaymentDTO } from "@/lib/dto";
import { amount, dateTime } from "@/lib/format";

function Row({ l, v, mono }: { l: string; v: string; mono?: boolean }) {
  return (
    <div className="pp-stat">
      <span className="mut" style={{ flex: "none" }}>{l}</span>
      <span className="v" style={mono ? { fontFamily: "ui-monospace,monospace", fontSize: 12, wordBreak: "break-all", textAlign: "right" } : { textAlign: "right" }}>{v}</span>
    </div>
  );
}

/**
 * One payment, exactly as recorded. The status is whatever the provider or chain reported:
 * nothing here is marked successful because an agent started it.
 */
export function PaymentDetailBody({ p, demo }: { p: PaymentDTO; demo: boolean }) {
  return (
    <>
      <div style={{ textAlign: "center", padding: "8px 0 18px" }}>
        <div className="num" style={{ fontSize: 30, fontWeight: 800 }}>{amount(p.amount)}</div>
        <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>{p.asset} · {p.network}</div>
        <div style={{ marginTop: 10 }}><PaymentStatusPill status={p.status} /></div>
      </div>
      <div className="card" style={{ padding: "4px 16px" }}>
        <Row l="Recipient" v={p.supplierName} />
        <Row l="To address" v={p.recipientAddress} mono />
        <Row l="Transaction" v={p.transactionHash ?? "Not submitted yet"} mono />
        <Row l="Network" v={p.network} />
        <Row l="Asset" v={p.asset} />
        <Row l="Created" v={dateTime(p.createdAt)} />
        <Row l="Confirmed" v={p.confirmedAt ? dateTime(p.confirmedAt) : "Not confirmed"} />
      </div>
      {p.failureReason ? <div className="callout err" style={{ marginTop: 12 }}><Icon name="alert" /><div>{p.failureReason}</div></div> : null}
      <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Linked records</div>
      <div className="card" style={{ padding: "4px 16px" }}>
        <div className="pp-stat"><span className="mut">Order</span><Link className="linkbtn" href={`/orders/${p.orderId}`}>{p.orderNumber}</Link></div>
        <div className="pp-stat"><span className="mut">Supplier</span><Link className="linkbtn" href={`/sellers/${p.supplierId}`}>{p.supplierName}</Link></div>
      </div>
      <p className="mut3" style={{ fontSize: 11, textAlign: "center", marginTop: 14 }}>
        {demo ? "Demo: this transaction is simulated and was never sent to a network." : "Status reflects the actual response from the payment provider or chain."}
      </p>
    </>
  );
}
