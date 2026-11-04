import { createWalletClient, custom, getAddress } from "viem";
import { KITE_NETWORKS, type KiteChainId } from "@procura/shared";
import { api } from "./api-client";
import type { WalletDTO } from "./dto";

/** The minimal EIP-1193 surface we use. MetaMask and most browser wallets inject this as window.ethereum. */
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export class WalletError extends Error {
  constructor(public readonly code: "NO_WALLET" | "REJECTED" | "FAILED", message: string) {
    super(message);
    this.name = "WalletError";
  }
}

export function injectedProvider(): Eip1193 | null {
  const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
  return eth ?? null;
}

const hex = (n: number) => `0x${n.toString(16)}`;
const codeOf = (e: unknown) => (typeof e === "object" && e && "code" in e ? Number((e as { code: unknown }).code) : undefined);

async function ensureNetwork(p: Eip1193, chainId: KiteChainId) {
  const net = KITE_NETWORKS[chainId];
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(chainId) }] });
  } catch (e) {
    if (codeOf(e) === 4001) throw new WalletError("REJECTED", "You declined the network switch.");
    // 4902: the wallet does not know this network yet, so offer to add it.
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex(chainId), chainName: net.name, rpcUrls: [net.rpcUrl], blockExplorerUrls: [net.explorerUrl],
        nativeCurrency: { name: net.nativeSymbol, symbol: net.nativeSymbol, decimals: 18 },
      }],
    }).catch((err: unknown) => {
      throw new WalletError(codeOf(err) === 4001 ? "REJECTED" : "FAILED", "Could not switch your wallet to the Kite network.");
    });
  }
}

/**
 * Connect the browser wallet, have the person sign Procura's challenge, and link the address.
 * Signing moves no funds. The server verifies the signature; nothing here is trusted.
 */
export async function linkBrowserWallet(chainId: KiteChainId, label?: string): Promise<WalletDTO> {
  const provider = injectedProvider();
  if (!provider) throw new WalletError("NO_WALLET", "No browser wallet found. Install MetaMask or another EVM wallet, then try again.");
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const first = accounts[0];
    if (!first) throw new WalletError("FAILED", "Your wallet did not share an account.");
    const address = getAddress(first);
    await ensureNetwork(provider, chainId);

    const challenge = await api<{ message: string; token: string }>("/wallets/challenge", { method: "POST", body: { address, chainId } });
    const wallet = createWalletClient({ account: address, transport: custom(provider) });
    const signature = await wallet.signMessage({ account: address, message: challenge.message });
    return await api<WalletDTO>("/wallets", { method: "POST", body: { message: challenge.message, token: challenge.token, signature, ...(label ? { label } : {}) } });
  } catch (e) {
    if (e instanceof WalletError) throw e;
    if (codeOf(e) === 4001) throw new WalletError("REJECTED", "You declined the request in your wallet. Nothing was linked.");
    throw e;
  }
}
