"use client";

import Link from "next/link";
import { shortAddress } from "@procura/shared";
import { useApp } from "@/lib/app-context";
import { useWallets } from "@/lib/queries";
import { Icon } from "./icon";

/**
 * The always-visible way into wallets. Without a linked wallet it invites one; with one it shows the
 * address, so people can see at a glance which wallet their business pays from. Live mode only.
 */
export function WalletChip() {
  const { mode } = useApp();
  const wallets = useWallets();
  if (mode !== "live" || wallets.isLoading || wallets.isError) return null;
  const linked = (wallets.data ?? []).find((w) => w.status === "active");
  return (
    <Link
      href="/settings/wallets"
      className={`btn btn-sm top-new ${linked ? "btn-sec" : "btn-pri"}`}
      aria-label={linked ? `Wallet ${shortAddress(linked.address)}. Manage wallets` : "Connect wallet"}
    >
      <Icon name="wallet" strokeWidth={2.2} />
      <span className="lbl">{linked ? shortAddress(linked.address) : "Connect wallet"}</span>
    </Link>
  );
}
