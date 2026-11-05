"use client";

import { useApp } from "./app-context";
import { useWallets } from "./queries";

/**
 * A linked wallet is required to use the buyer: it is where funding comes from and what every
 * purchase traces back to. The gate waits for the answer, so nobody is blocked by a loading state.
 */
export function useWalletGate(): { needsWallet: boolean } {
  const { mode } = useApp();
  const wallets = useWallets();
  const linked = (wallets.data ?? []).some((w) => w.status === "active");
  return { needsWallet: mode === "live" && wallets.isSuccess && !linked };
}
