"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ApproveOrderModal, DestinationPill, type ApprovableOrder } from "@/components/approve-order";
import { Icon } from "@/components/icon";
import { Modal, useToast } from "@/components/overlays";
import { DemoPasskeyModal } from "@/components/passkey";
import { PassportCard } from "@/components/passport-card";
import { Async, DemoTag, EmptyState, FilterChips, OrderStatusPill, PageHead, Pill } from "@/components/ui";
import { useApp, useCan } from "@/lib/app-context";
import type { ApprovalDTO } from "@/lib/dto";
import { spentOrders, totalOf } from "@/lib/derive";
import { amount, minus, moneyShort, shortAddress, shortDate } from "@/lib/format";
import { errorMessage, useApprovals, useOrders, usePolicy, useRejectOrder } from "@/lib/queries";

const TABS = ["Pending", "Approved", "Rejected", "Expired"] as const;

function toApprovable(a: ApprovalDTO): ApprovableOrder {
  return {
    id: a.orderId, orderNumber: a.orderNumber, supplierId: a.supplierId, supplierName: a.supplierName, total: a.amount, currency: a.currency,
    paymentAsset: a.paymentAsset, paymentAmount: a.paymentAmount, destination: a.destination,
  };
}

export default function ApprovalsPage() {
  const { mode, business } = useApp();
  const approvals = useApprovals();
  const orders = useOrders();
  const policy = usePolicy();
  const { show } = useToast();
  const reject = useRejectOrder();
  const canDecide = useCan("approvals:decide");

  const [tab, setTab] = useState<(typeof TABS)[number]>("Pending");
  const [approving, setApproving] = useState<ApprovalDTO | null>(null);
  const [passkey, setPasskey] = useState<ApprovalDTO | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalDTO | null>(null);

  const monthStart = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }, []);
  const remaining = policy.data && orders.data
    ? minus(policy.data.maxTotalSpend, totalOf(spentOrders(orders.data, policy.data.currency, monthStart), policy.data.currency)) : null;

  const rows = (approvals.data ?? []).filter((a) =>
    tab === "Pending" ? a.status === "pending" || a.status === "changes_requested" : a.status === tab.toLowerCase());

  return (
    <>
      <PageHead title="Approvals" sub="Review the financial actions that require your authorisation." />
      <FilterChips options={[...TABS]} value={tab} onChange={(v) => setTab(v as (typeof TABS)[number])} />
      <div className="appr-grid">
        <div>
          <Async query={approvals}>
            {() => rows.length === 0 ? (
              <div className="card"><EmptyState icon="shield" title={tab === "Pending" ? "Nothing waiting for approval" : `No ${tab.toLowerCase()} approvals`}>
                {tab === "Pending" ? "When Procura prepares an order that needs your authorisation, it appears here." : "Nothing to show in this view yet."}
              </EmptyState></div>
            ) : rows.map((a, idx) => {
              const pending = a.status === "pending" || a.status === "changes_requested";
              const toPay = a.status === "approved" && a.orderStatus === "approved";
              return (
                <div key={a.id} className="card appr-card" data-tour={idx === 0 ? "approval-card" : undefined}
                  style={{ borderLeftColor: pending ? "var(--warn)" : a.status === "approved" ? "var(--ok)" : "var(--line-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 4 }}>{a.requestNumber} · {a.orderNumber}</div>
                      <h2 style={{ fontSize: 17 }}>{a.requestTitle}</h2>
                    </div>
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {a.supplierSource === "demo" ? <DemoTag>Demo</DemoTag> : null}
                      {pending ? <Pill tone="warn">Awaiting authorisation</Pill> : a.status === "approved" ? <Pill tone="ok">Approved</Pill> : a.status === "rejected" ? <Pill tone="err">Rejected</Pill> : <Pill tone="mute">Expired</Pill>}
                    </span>
                  </div>
                  {a.reason ? (
                    <div className="reason" style={{ marginTop: 8 }}><div className="rl"><Icon name="spark" /> Why this is requested</div>{a.reason}</div>
                  ) : null}
                  <div className="recipient-box">
                    <span className="k-ic" style={{ background: "var(--surface)", color: "var(--forest-2)" }}><Icon name="wallet" /></span>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Payment recipient: {a.supplierName}</div>
                      <div className="addr" title={a.destination?.address}>{a.destination ? `${shortAddress(a.destination.address)} · ${a.destination.network} · ${a.destination.asset}` : "No payment address"}</div>
                    </div>
                    <DestinationPill d={a.destination} />
                  </div>
                  <div className="appr-row"><span className="mut">Order total</span><span className="v num">{amount(a.amount)} {a.currency}</span></div>
                  <div className="appr-row"><span className="mut">Payable as</span><span className="v num">{amount(a.paymentAmount)} {a.paymentAsset}</span></div>
                  <div className="appr-row"><span className="mut">Budget remaining (month)</span><span className="v num">{remaining ? moneyShort(remaining, business.defaultCurrency) : "-"}</span></div>
                  <div className="appr-row"><span className="mut">Per-transaction limit</span><span className="v num">{policy.data ? moneyShort(policy.data.maxTransactionAmount, policy.data.currency) : "-"}</span></div>
                  <div className="appr-row"><span className="mut">{pending ? "Request expires" : "Decided"}</span><span className="v">{pending ? (a.expiresAt ? shortDate(a.expiresAt) : "-") : shortDate(a.decidedAt)}</span></div>

                  {pending ? (
                    <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }} data-tour="approval-actions">
                      {canDecide ? (
                        mode === "demo"
                          ? <button className="btn btn-pri btn-lg" style={{ flex: 1 }} onClick={() => { setPasskey(a); }}><Icon name="key" /> Approve spending session</button>
                          : <button className="btn btn-pri btn-lg" style={{ flex: 1 }} onClick={() => setApproving(a)}><Icon name="shield" /> Review and approve</button>
                      ) : null}
                      {canDecide ? <button className="btn btn-sec btn-lg" onClick={() => setRejecting(a)}>Reject</button> : null}
                      <Link href={`/orders/${a.orderId}`} className="btn btn-ghost btn-lg">View order</Link>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap", alignItems: "center" }}>
                      <OrderStatusPill status={a.orderStatus} />
                      <Link href={`/orders/${a.orderId}`} className="btn btn-sec btn-sm">View order</Link>
                      {toPay && mode === "demo" && canDecide ? <button className="btn btn-pri btn-sm" onClick={() => { setPasskey(a); }}><Icon name="key" /> Simulate payment</button> : null}
                    </div>
                  )}
                  {pending ? (
                    <p className="mut3" style={{ fontSize: 11.5, textAlign: "center", marginTop: 12 }}>
                      {mode === "demo"
                        ? "Demo: the passkey step is simulated and no money moves."
                        : "Approving records your decision. Paying needs a Kite Passport spending session, which is not connected yet."}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </Async>
        </div>
        <div><PassportCard /></div>
      </div>

      <ApproveOrderModal open={!!approving} onClose={() => setApproving(null)} order={approving ? toApprovable(approving) : null} />
      <DemoPasskeyModal open={!!passkey} onClose={() => setPasskey(null)} order={passkey ? toApprovable(passkey) : null} />
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} label="Reject order">
        <div className="modal-body" style={{ textAlign: "left" }}>
          <h3>Reject {rejecting?.orderNumber}?</h3>
          <p>The order is cancelled and the request returns to comparison.</p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-sec" style={{ flex: 1 }} onClick={() => setRejecting(null)}>Keep it</button>
          <button className="btn btn-forest" style={{ flex: 1 }} disabled={reject.isPending} onClick={async () => {
            if (!rejecting) return;
            try { await reject.mutateAsync({ id: rejecting.orderId }); show(`${rejecting.orderNumber} rejected`); } catch (e) { show(errorMessage(e), "err"); }
            setRejecting(null);
          }}>{reject.isPending ? "Rejecting…" : "Reject order"}</button>
        </div>
      </Modal>
    </>
  );
}
