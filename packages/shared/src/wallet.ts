/**
 * Wallet linking. A person proves they control an address by signing a challenge (EIP-191
 * personal_sign). Signing moves no funds and grants Procura no access to them. Pure and
 * browser-safe: the server builds and verifies the challenge; the browser only shows it and signs.
 */

export const WALLET_STATUSES = ["active", "revoked"] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

/** Kite networks, from https://docs.gokite.ai/kite-chain/1-getting-started/network-information */
export const KITE_NETWORKS = {
  2368: {
    chainId: 2368, name: "KiteAI Testnet", rpcUrl: "https://rpc-testnet.gokite.ai/",
    explorerUrl: "https://testnet.kitescan.ai", faucetUrl: "https://faucet.gokite.ai", nativeSymbol: "KITE", testnet: true,
  },
  2366: {
    chainId: 2366, name: "KiteAI Mainnet", rpcUrl: "https://rpc.gokite.ai/",
    explorerUrl: "https://kitescan.ai", faucetUrl: null, nativeSymbol: "KITE", testnet: false,
  },
} as const;
export type KiteChainId = keyof typeof KITE_NETWORKS;
/** Wallets are linked on the testnet until the escrow and payment flow is audited. */
export const DEFAULT_WALLET_CHAIN_ID: KiteChainId = 2368;

export const CHALLENGE_TTL_MS = 10 * 60_000;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const isEvmAddress = (v: string): boolean => ADDRESS.test(v);

export interface WalletChallenge {
  domain: string;
  address: string;
  businessId: string;
  userId: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** The exact text the wallet shows and the person signs. Addresses are compared lowercase. */
export function buildWalletChallenge(c: WalletChallenge): string {
  return [
    `${c.domain} wants you to link a wallet to Procura.`,
    "",
    `Address: ${c.address.toLowerCase()}`,
    `Business: ${c.businessId}`,
    `User: ${c.userId}`,
    `Chain ID: ${c.chainId}`,
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt.toISOString()}`,
    `Expires At: ${c.expiresAt.toISOString()}`,
    "",
    "Signing proves you control this address. It does not move funds or give Procura access to them.",
  ].join("\n");
}

/** Reads a challenge back out of its text. Null if it is not exactly the format we build. */
export function parseWalletChallenge(message: string): WalletChallenge | null {
  const line = (label: string) => new RegExp(`^${label}: (.+)$`, "m").exec(message)?.[1]?.trim();
  const domain = /^(.+) wants you to link a wallet to Procura\.$/m.exec(message)?.[1];
  const address = line("Address"), businessId = line("Business"), userId = line("User");
  const chain = line("Chain ID"), nonce = line("Nonce"), issued = line("Issued At"), expires = line("Expires At");
  if (!domain || !address || !businessId || !userId || !chain || !nonce || !issued || !expires) return null;
  if (!isEvmAddress(address) || !/^\d+$/.test(chain)) return null;
  const issuedAt = new Date(issued), expiresAt = new Date(expires);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) return null;
  const parsed: WalletChallenge = { domain, address, businessId, userId, chainId: Number(chain), nonce, issuedAt, expiresAt };
  // Round trip: anything that does not rebuild byte for byte is rejected, so no field can be smuggled in.
  return buildWalletChallenge(parsed) === message ? parsed : null;
}

export const shortAddress = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/* ------------------------------------------------------------------ */
/* Funding the buyer: a USDC transfer on Base to the Passport wallet    */
/* ------------------------------------------------------------------ */

/** Kite Passport's wallet is funded by sending USDC to its address. Base is the chain we offer a send button for. */
export const BASE_CHAIN_ID = 8453;
/** Circle's native USDC on Base mainnet. */
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_EXPLORER = "https://basescan.org";
export const USDC_DECIMALS = 6;

/** "12.5" becomes 12500000n. Null for anything that is not a positive amount with at most six decimals. */
export function parseUsdcAmount(input: string): bigint | null {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!m) return null;
  const units = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return units > 0n ? units : null;
}

/** ERC-20 `transfer(address,uint256)` call data. Throws on an address or amount that is not valid. */
export function usdcTransferData(to: string, units: bigint): `0x${string}` {
  if (!isEvmAddress(to)) throw new Error("Not a valid wallet address.");
  if (units <= 0n) throw new Error("Amount must be greater than zero.");
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${units.toString(16).padStart(64, "0")}`;
}
