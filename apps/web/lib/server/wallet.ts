import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, verifyMessage } from "viem";
import {
  buildWalletChallenge, CHALLENGE_TTL_MS, KITE_NETWORKS, parseWalletChallenge, ServiceError, type KiteChainId,
} from "@procura/shared";
import { serverEnv } from "../env";

/**
 * Wallet linking. The challenge is stateless: the server signs the exact text with an HMAC, so a
 * returned challenge cannot be altered, forged or reused for another user, business or address.
 * The wallet signature then proves control of the address. Smart-contract wallets (ERC-1271) are
 * not supported yet; this verifies ordinary externally owned accounts.
 */

const mac = (message: string) => createHmac("sha256", serverEnv().BETTER_AUTH_SECRET).update(`procura-wallet-link\n${message}`).digest("hex");

export function networkFor(chainId: number) {
  const n = KITE_NETWORKS[chainId as KiteChainId];
  if (!n) throw new ServiceError("UNSUPPORTED_CHAIN", "That network is not supported.", 422);
  return n;
}

export interface IssuedChallenge { message: string; token: string; expiresAt: string }

export function issueChallenge(input: { domain: string; address: string; chainId: number; businessId: string; userId: string; now?: Date }): IssuedChallenge {
  networkFor(input.chainId);
  const issuedAt = input.now ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const message = buildWalletChallenge({
    domain: input.domain, address: input.address, businessId: input.businessId, userId: input.userId,
    chainId: input.chainId, nonce: randomBytes(16).toString("hex"), issuedAt, expiresAt,
  });
  return { message, token: mac(message), expiresAt: expiresAt.toISOString() };
}

const invalid = (why: string) => new ServiceError("INVALID_WALLET_PROOF", why, 422);

/** Throws unless the signed challenge is genuine, current, for this caller, and signed by its address. */
export async function verifyLink(input: {
  message: string; token: string; signature: string; domain: string; businessId: string; userId: string; now?: Date;
}): Promise<{ address: string; chainId: number }> {
  const expected = Buffer.from(mac(input.message), "hex");
  const given = Buffer.from(input.token, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid("This challenge was not issued by Procura.");

  const c = parseWalletChallenge(input.message);
  if (!c) throw invalid("The challenge is malformed.");
  const now = input.now ?? new Date();
  if (c.expiresAt.getTime() <= now.getTime()) throw invalid("The challenge expired. Start again.");
  if (c.domain !== input.domain) throw invalid("The challenge was issued for a different site.");
  if (c.businessId !== input.businessId || c.userId !== input.userId) throw invalid("The challenge belongs to a different account.");
  networkFor(c.chainId);

  let valid = false;
  try {
    valid = await verifyMessage({ address: getAddress(c.address), message: input.message, signature: input.signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) throw invalid("The signature does not match that address.");
  return { address: c.address.toLowerCase(), chainId: c.chainId };
}

export interface WalletBalances {
  status: "ok" | "unavailable";
  chainId: number;
  native: { symbol: string; amount: string } | null;
  token: { symbol: string; amount: string; address: string } | null;
  /** True when no payment token is configured, so only the native balance is shown. */
  tokenNotConfigured: boolean;
}

/**
 * Read-only balances straight from the chain. A failure is reported as "unavailable", never as zero.
 * Amounts are decimal strings formatted from the integer balance, so no float is ever involved.
 */
export async function readBalances(address: string, chainId: number): Promise<WalletBalances> {
  const net = networkFor(chainId);
  const tokenAddress = serverEnv().PAYMENT_TOKEN_ADDRESS;
  const base = { chainId, native: null, token: null, tokenNotConfigured: !tokenAddress } as const;
  // viem retries transient transport errors itself; the first connection to a cold RPC is the usual one to fail.
  const client = createPublicClient({ transport: http(net.rpcUrl, { timeout: 10_000, retryCount: 2, retryDelay: 400 }) });
  try {
    const owner = getAddress(address);
    const native = await client.getBalance({ address: owner });
    let token: WalletBalances["token"] = null;
    if (tokenAddress) {
      const t = getAddress(tokenAddress);
      const [raw, decimals, symbol] = await Promise.all([
        client.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        client.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }),
        client.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }),
      ]);
      token = { symbol, amount: formatUnits(raw, decimals), address: t };
    }
    return { status: "ok", ...base, native: { symbol: net.nativeSymbol, amount: formatUnits(native, 18) }, token };
  } catch (e) {
    console.error("wallet balance read failed:", e instanceof Error ? e.message : e);
    return { status: "unavailable", ...base };
  }
}
