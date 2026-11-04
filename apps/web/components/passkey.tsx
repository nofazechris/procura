"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { Modal, useToast } from "./overlays";
import type { ApprovableOrder } from "./approve-order";
import { amount, shortAddress } from "@/lib/format";
import { errorMessage, useDemoPayment } from "@/lib/queries";

type Phase = "review" | "scanning" | "done";

/**
 * DEMO ONLY. A simulated Kite Passport passkey approval followed by a simulated payment.
 * Live mode has no equivalent until the Passport integration is built, because a real approval
 * must come from the Passport passkey flow, never from a button in this app. The demo says so.
 */
export function DemoPasskeyModal({ order, open, onClose }: {
  order: ApprovableOrder | null; open: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const { show } = useToast();
  const pay = useDemoPayment();
  const [phase, setPhase] = useState<Phase>("review");
  const [hash, setHash] = useState<string>("");
  const started = useRef(false);

  useEffect(() => { if (open) { setPhase("review"); setHash(""); started.current = false; } }, [open]);

  async function confirm() {
    if (!order || started.current) return;
    started.current = true;
    setPhase("scanning");
    try {
      const [payment] = await Promise.all([pay.mutateAsync(order.id), new Promise((r) => setTimeout(r, 2100))]);
      setHash(payment.transactionHash ?? "");
      setPhase("done");
      show(`Payment confirmed (demo): ${amount(payment.amount)} ${payment.asset}`);
    } catch (e) {
      started.current = false;
      setPhase("review");
      show(errorMessage(e), "err");
    }
  }

  if (!order) return <Modal open={false} onClose={onClose} label="Passkey">{null}</Modal>;

  return (
    <Modal open={open} onClose={phase === "scanning" ? () => {} : onClose} label="Authorise spending session">
      {phase === "done" ? (
        <>
          <div className="modal-body">
            <div className="pk-ring ok"><Icon name="check" strokeWidth={3} /></div>
            <h3>Payment executed (demo)</h3>
            <p>This is a simulation. In the live product the agent pays through Kite Passport and the status comes from the chain, never from the agent.</p>
            <div className="tx-hash"><Icon name="ext" /> {hash ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : "demo transaction"}</div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-sec" style={{ flex: 1 }} onClick={onClose}>Close</button>
            <button className="btn btn-pri" style={{ flex: 1 }} onClick={() => { onClose(); router.push("/payments"); }}>View payment <Icon name="arr" /></button>
          </div>
        </>
      ) : (
        <>
          <div className="modal-body">
            <div className={`pk-ring ${phase === "scanning" ? "scanning" : ""}`}><Icon name="finger" /></div>
            <h3>Authorise spending session</h3>
            <p>Confirm with your passkey to let Procura pay within your approved limits. Demo: no real passkey is used.</p>
            <div className="modal-sum">
              <div className="r"><span className="mut">Recipient</span><b>{order.supplierName}</b></div>
              <div className="r"><span className="mut">Address</span><b>{order.destination ? shortAddress(order.destination.address) : "-"}</b></div>
              <div className="r"><span className="mut">Amount</span><b className="num">{amount(order.paymentAmount)} {order.paymentAsset}</b></div>
              <div className="r"><span className="mut">Network</span><b>Kite testnet</b></div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-sec" style={{ flex: 1 }} disabled={phase === "scanning"} onClick={onClose}>Cancel</button>
            <button className="btn btn-pri" style={{ flex: 1, opacity: phase === "scanning" ? 0.5 : 1 }} disabled={phase === "scanning"} onClick={() => void confirm()}>
              <Icon name="key" /> {phase === "scanning" ? "Authenticating…" : "Confirm with passkey"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
