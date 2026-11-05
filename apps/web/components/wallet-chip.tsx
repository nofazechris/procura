"use client";

import { shortAddress } from "@procura/shared";
import { useApp } from "@/lib/app-context";
import { useWallets } from "@/lib/queries";
import { openBuyerPanel } from "@/lib/buyer-panels";
import { Icon } from "./icon";

/**
 * The always-visible way into the wallet. Without a linked wallet it invites one; with one it shows the
 * address, so people can see at a glance which wallet they fund their buyer from. Live mode only.
 */
export function WalletChip() {
  const { mode } = useApp();
  const wallets = useWallets();
  if (mode !== "live" || wallets.isLoading || wallets.isError) return null;
  const linked = (wallets.data ?? []).find((w) => w.status === "active");
  return (
    <button
      type="button"
      onClick={() => openBuyerPanel(linked ? "fund" : "wallet")}
      className={`btn btn-sm top-new ${linked ? "btn-sec" : "btn-pri"}`}
      aria-label={linked ? `Wallet ${shortAddress(linked.address)}. Fund your buyer` : "Connect wallet"}
    >
      <Icon name="wallet" strokeWidth={2.2} />
      <span className="lbl">{linked ? shortAddress(linked.address) : "Connect wallet"}</span>
    </button>
  );
}
