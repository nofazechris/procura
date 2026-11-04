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
