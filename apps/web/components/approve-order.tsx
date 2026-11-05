"use client";

import { Icon } from "./icon";
import { Modal, useToast } from "./overlays";
import { Pill } from "./ui";
import { useCan } from "@/lib/app-context";
import type { PayoutDestinationDTO } from "@/lib/dto";
import { amount, shortAddress } from "@/lib/format";
import { errorMessage, useApproveOrder, useApprovePayout, usePolicy } from "@/lib/queries";

export interface ApprovableOrder {
  id: string; orderNumber: string; supplierId: string; supplierName: string;
  total: string; currency: string; paymentAsset: string; paymentAmount: string;
  destination: PayoutDestinationDTO | null;
  /** Paid at a marketplace's own checkout, so there is no payout address to approve. */
  marketplace?: boolean;
}

/**
 * The human approval step. It shows exactly who will be paid and how much, and records the
 * approval. It does not move money: payment needs a Kite Passport spending session.
 */
export function ApproveOrderModal({ order, open, onClose, onApproved }: {
  order: ApprovableOrder | null; open: boolean; onClose: () => void; onApproved?: () => void;
}) {
  const { show } = useToast();
  const approve = useApproveOrder();
  const approveAddress = useApprovePayout();
  const policy = usePolicy();
  const canDecide = useCan("approvals:decide");

  if (!order) return <Modal open={false} onClose={onClose} label="Approve order">{null}</Modal>;
  const dest = order.destination;
  const addressOk = order.marketplace || dest?.status === "approved";

  async function approveAddr() {
    if (!dest) return;
    try { await approveAddress.mutateAsync({ supplierId: order!.supplierId, destinationId: dest.id }); show("Payment address approved"); }
    catch (e) { show(errorMessage(e), "err"); }
  }

  async function confirm() {
    try {
      await approve.mutateAsync(order!.id);
      show(`${order!.orderNumber} approved`);
      onClose();
      onApproved?.();
    } catch (e) { show(errorMessage(e), "err"); }
  }

  return (
    <Modal open={open} onClose={onClose} label="Approve order" wide>
      <div className="modal-body" style={{ textAlign: "left" }}>
        <h3>Approve {order.orderNumber}</h3>
        <p>Check who will be paid and how much. Approving records your decision. It does not move money.</p>
        <div className="modal-sum">
          <div className="r"><span className="mut">Seller</span><b>{order.supplierName}</b></div>
          <div className="r"><span className="mut">Order total</span><b className="num">{amount(order.total)} {order.currency}</b></div>
          <div className="r"><span className="mut">Payable as</span><b className="num">{amount(order.paymentAmount)} {order.paymentAsset}</b></div>
          <div className="r"><span className="mut">Pays to</span><b title={dest?.address}>{order.marketplace ? "Amazon checkout" : dest ? shortAddress(dest.address) : "No address"}</b></div>
          {policy.data ? <div className="r"><span className="mut">Per-purchase limit</span><b className="num">{amount(policy.data.maxTransactionAmount, 0)} {policy.data.currency}</b></div> : null}
        </div>
        {order.marketplace ? (
          <div className="callout ok"><Icon name="check" /><div>Amazon is paid at its own checkout, from a capped session you approve with your passkey. There is no payment address to approve.</div></div>
        ) : !dest ? (
          <div className="callout err"><Icon name="alert" /><div>This seller has no payment address. Add one before approving.</div></div>
        ) : addressOk ? (
          <div className="callout ok"><Icon name="check" /><div>The payment address is approved. Only this address can be paid.</div></div>
        ) : (
          <div className="callout warn">
            <Icon name="alert" />
            <div>
              <b>The payment address is not approved yet.</b> Procura can only pay an address a person has approved.
              {canDecide ? <div style={{ marginTop: 8 }}><button className="btn btn-sec btn-sm" disabled={approveAddress.isPending} onClick={() => void approveAddr()}>{approveAddress.isPending ? "Approving…" : "Approve this address"}</button></div> : <div style={{ marginTop: 6 }}>Ask an owner or finance manager to approve it.</div>}
            </div>
          </div>
        )}
        {!canDecide ? <div className="callout info" style={{ marginTop: 10 }}><Icon name="alert" /><div>Only you can approve spending.</div></div> : null}
      </div>
      <div className="modal-foot">
        <button className="btn btn-sec" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn btn-pri" style={{ flex: 1 }} disabled={!canDecide || !addressOk || approve.isPending} onClick={() => void confirm()}>
          {approve.isPending ? "Approving…" : "Approve order"}
        </button>
      </div>
    </Modal>
  );
}

export function DestinationPill({ d }: { d: PayoutDestinationDTO | null }) {
  if (!d) return <Pill tone="err">No address</Pill>;
  return d.status === "approved" ? <Pill tone="ok">Approved address</Pill> : d.status === "pending" ? <Pill tone="warn">Address not approved</Pill> : <Pill tone="mute">Revoked</Pill>;
}
