"use client";

import { openBuyerPanel } from "@/lib/buyer-panels";
import { Icon } from "./icon";

/** Shown in place of anything that starts a purchase until a wallet is connected. */
export function WalletRequired() {
  return (
    <div className="card" style={{ padding: 22, display: "grid", gap: 12, borderColor: "var(--warn)" }} role="alert">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span className="k-ic" style={{ flex: "none" }}><Icon name="wallet" /></span>
        <div>
          <b style={{ fontSize: 16 }}>Connect your wallet to start</b>
          <p className="mut" style={{ fontSize: 13, margin: "6px 0 0", maxWidth: "62ch" }}>
            Your buyer pays from its own Kite Passport wallet, which you fund from the wallet you connect. Connecting takes one signature, moves no money,
            and lets Procura trace every purchase back to you. Searching stays locked until it is done.
          </p>
        </div>
      </div>
      <div><button className="btn btn-pri" onClick={() => openBuyerPanel("wallet")}><Icon name="wallet" /> Connect wallet</button></div>
    </div>
  );
}
