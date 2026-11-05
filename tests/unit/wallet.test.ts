import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildWalletChallenge, CHALLENGE_TTL_MS, isEvmAddress, MEMBER_ROLES, parseWalletChallenge, roleHasPermission } from "@procura/shared";
import { issueChallenge, verifyLink } from "../../apps/web/lib/server/wallet";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const USER = "user-1";
const DOMAIN = "procura.test";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
});

const owner = privateKeyToAccount(generatePrivateKey());
const attacker = privateKeyToAccount(generatePrivateKey());

function issue(address = owner.address, now = new Date()) {
  return issueChallenge({ domain: DOMAIN, address, chainId: 2368, businessId: BUSINESS, userId: USER, now });
}
const verify = (c: { message: string; token: string }, signature: string, over: Partial<Parameters<typeof verifyLink>[0]> = {}) =>
  verifyLink({ message: c.message, token: c.token, signature, domain: DOMAIN, businessId: BUSINESS, userId: USER, ...over });

describe("wallet challenge text", () => {
  it("round-trips, and rejects anything that does not rebuild exactly", () => {
    const now = new Date("2026-11-04T10:00:00.000Z");
    const c = { domain: DOMAIN, address: owner.address, businessId: BUSINESS, userId: USER, chainId: 2368, nonce: "ab12", issuedAt: now, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) };
    const text = buildWalletChallenge(c);
    expect(parseWalletChallenge(text)?.address).toBe(owner.address.toLowerCase());
    expect(parseWalletChallenge(text + "\nExtra: smuggled")).toBeNull();
    expect(parseWalletChallenge(text.replace("Chain ID: 2368", "Chain ID: 2366"))?.chainId).toBe(2366); // parses, but the HMAC will not match
    expect(parseWalletChallenge("not a challenge")).toBeNull();
  });

  it("validates addresses", () => {
    expect(isEvmAddress(owner.address)).toBe(true);
    expect(isEvmAddress("0x123")).toBe(false);
    expect(isEvmAddress("not an address")).toBe(false);
  });
});

describe("linking a wallet by signature", () => {
  it("accepts the real owner's signature", async () => {
    const c = issue();
    const sig = await owner.signMessage({ message: c.message });
    await expect(verify(c, sig)).resolves.toEqual({ address: owner.address.toLowerCase(), chainId: 2368 });
  });

  it("rejects a signature from a different key", async () => {
    const c = issue();
    const sig = await attacker.signMessage({ message: c.message });
    await expect(verify(c, sig)).rejects.toMatchObject({ code: "INVALID_WALLET_PROOF" });
  });

  it("rejects a challenge the server did not issue, or one that was edited", async () => {
    const c = issue();
    const sig = await owner.signMessage({ message: c.message });
    await expect(verify({ ...c, token: "0".repeat(64) }, sig)).rejects.toMatchObject({ code: "INVALID_WALLET_PROOF" });
    // Attacker swaps in their own address and signs that: the HMAC no longer matches.
    const forged = c.message.replace(owner.address.toLowerCase(), attacker.address.toLowerCase());
    const forgedSig = await attacker.signMessage({ message: forged });
    await expect(verify({ message: forged, token: c.token }, forgedSig)).rejects.toMatchObject({ code: "INVALID_WALLET_PROOF" });
  });

  it("rejects an expired challenge", async () => {
    const c = issue(owner.address, new Date(Date.now() - CHALLENGE_TTL_MS - 1000));
    const sig = await owner.signMessage({ message: c.message });
    await expect(verify(c, sig)).rejects.toThrow(/expired/i);
  });

  it("cannot be replayed by another user, another business, or on another site", async () => {
    const c = issue();
    const sig = await owner.signMessage({ message: c.message });
    await expect(verify(c, sig, { userId: "someone-else" })).rejects.toThrow(/different account/);
    await expect(verify(c, sig, { businessId: "22222222-2222-4222-8222-222222222222" })).rejects.toThrow(/different account/);
    await expect(verify(c, sig, { domain: "evil.example" })).rejects.toThrow(/different site/);
  });

  it("refuses unsupported networks and garbage signatures", async () => {
    expect(() => issueChallenge({ domain: DOMAIN, address: owner.address, chainId: 1, businessId: BUSINESS, userId: USER })).toThrow(/not supported/);
    const c = issue();
    await expect(verify(c, "0x1234")).rejects.toMatchObject({ code: "INVALID_WALLET_PROOF" });
  });
});

describe("wallet permission", () => {
  it("only the owner and finance manager can link or revoke wallets", () => {
    expect(MEMBER_ROLES.filter((r) => roleHasPermission(r, "wallet:manage")).sort()).toEqual(["finance_manager", "owner"]);
  });
});

describe("funding the buyer", () => {
  it("reads a USDC amount exactly, never through a float", async () => {
    const { parseUsdcAmount } = await import("@procura/shared");
    expect(parseUsdcAmount("25")).toBe(25_000_000n);
    expect(parseUsdcAmount("12.5")).toBe(12_500_000n);
    expect(parseUsdcAmount("0.000001")).toBe(1n);
    expect(parseUsdcAmount(" 3.10 ")).toBe(3_100_000n);
  });

  it("rejects anything that is not a positive amount with at most six decimals", async () => {
    const { parseUsdcAmount } = await import("@procura/shared");
    for (const bad of ["", "0", "0.0", "-5", "1e3", "1,000", "1.1234567", "abc", "1.", ".5", "1000000000"]) expect(parseUsdcAmount(bad), bad).toBeNull();
  });

  it("builds the ERC-20 transfer call data", async () => {
    const { usdcTransferData } = await import("@procura/shared");
    expect(usdcTransferData("0x1111111111111111111111111111111111111111", 25_000_000n)).toBe(
      "0xa9059cbb" + "0".repeat(24) + "1".repeat(40) + "0".repeat(57) + "17d7840",
    );
  });

  it("refuses an invalid recipient or a zero amount rather than sending something odd", async () => {
    const { usdcTransferData } = await import("@procura/shared");
    expect(() => usdcTransferData("0x123", 1n)).toThrow();
    expect(() => usdcTransferData("not an address", 1n)).toThrow();
    expect(() => usdcTransferData("0x1111111111111111111111111111111111111111", 0n)).toThrow();
  });
});
