import { beforeAll, describe, expect, it } from "vitest";
import {
  buildCall, costExceeds, estimateCost, isVerifyUrl, normaliseName, parseEmail, parseRegistry, parseSanctions, plannedChecks,
  sameBusinessName, summariseEvidence, VERIFY_CHECK_IDS, VERIFY_CHECKS,
} from "@procura/procurement";
import { VerifySupplierSchema } from "@procura/shared";
import { paymentKey } from "../../apps/web/lib/server/verify";
import { paidCall, readPaidResult, setKpassExecutor, type KpassResult } from "../../apps/web/lib/server/passport";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
  process.env.PASSPORT_HOME = "C:/tmp/passport";
});

const facts = { name: "Ikeja Office Supply", legalName: "Ikeja Office Supply Ltd", countryCode: "NG", email: "sales@ikeja-office.example" };

describe("planning and pricing", () => {
  it("prices every check exactly and adds only the checks that can run", () => {
    const all = plannedChecks(facts);
    expect(all.map((p) => p.id)).toEqual([...VERIFY_CHECK_IDS]);
    expect(estimateCost(all)).toBe("0.015000");
    const noEmail = plannedChecks({ ...facts, email: null });
    expect(noEmail.find((p) => p.id === "email")).toMatchObject({ ready: false, missing: "a contact email address" });
    expect(estimateCost(noEmail)).toBe("0.011000");
  });

  it("will not buy a registry lookup without a country, or anything without a name", () => {
    expect(plannedChecks({ ...facts, countryCode: "Nigeria" }).find((p) => p.id === "registry")?.ready).toBe(false);
    expect(plannedChecks({ name: "  " }).every((p) => !p.ready)).toBe(true);
    expect(estimateCost(plannedChecks({ name: "  " }))).toBe("0.000000");
  });

  it("compares prices as exact decimals, never floats", () => {
    expect(costExceeds("0.015000", "0.015")).toBe(false);
    expect(costExceeds("0.015001", "0.015")).toBe(true);
    expect(costExceeds("0.1", "0.099999")).toBe(true);
  });

  it("builds calls only to the three known services, over https, with the query encoded", () => {
    for (const id of VERIFY_CHECK_IDS) expect(isVerifyUrl(buildCall(id, facts).url)).toBe(true);
    expect(buildCall("sanctions", { name: "A&B Trading; rm -rf" }).url).toBe("https://x402.tbs-digital.com/screen/entity?name=A%26B+Trading%3B+rm+-rf");
    expect(buildCall("registry", facts)).toMatchObject({ method: "POST", body: { legal_name: "Ikeja Office Supply Ltd", country: "NG" } });
    expect(isVerifyUrl("http://x402.tbs-digital.com/screen/entity")).toBe(false);
    expect(isVerifyUrl("https://evil.example/screen/entity")).toBe(false);
    expect(isVerifyUrl("https://x402.tbs-digital.com.evil.example/screen/entity")).toBe(false);
    expect(isVerifyUrl("https://x402.tbs-digital.com/other")).toBe(false);
  });

  it("the request schema matches the check ids the engine knows", () => {
    const ok = VerifySupplierSchema.safeParse({ checks: [...VERIFY_CHECK_IDS], sessionId: "11111111-1111-4111-8111-111111111111", maxCost: "0.015" });
    expect(ok.success).toBe(true);
    expect(VerifySupplierSchema.safeParse({ checks: ["wire_transfer"], sessionId: "x", maxCost: "1" }).success).toBe(false);
  });
});

describe("sanctions screening", () => {
  it("a clear result does not verify anything: it rules a listed name out and no more", () => {
    const o = parseSanctions({ match_count: 0, matches: [], lists_checked: [{ list: "OFAC SDN", entries: 1 }] });
    expect(o.status).toBe("unverified");
  });
  it("a possible match fails the check, naming the list", () => {
    const o = parseSanctions({ match_count: 1, matches: [{ name: "IKEJA OFFICE", list: "OFAC SDN", score: 0.93 }] });
    expect(o.status).toBe("failed");
    expect(o.summary).toContain("OFAC SDN");
  });
  it("an answer it cannot read is unknown, never clear", () => {
    expect(parseSanctions({}).status).toBe("unknown");
    expect(parseSanctions({ match_count: 0 }).status).toBe("unknown");
    expect(parseSanctions(null).status).toBe("unknown");
    expect(parseSanctions("ok").status).toBe("unknown");
  });
});

describe("company registry", () => {
  const found = { match: { legal_name: "Ikeja Office Supply Limited", lei: "5493001KJTIIGC8Y1R12", jurisdiction: "NG", status: "ACTIVE", match_score: 0.97, registration: { authority_id: "RA000001", status: "ISSUED" } }, candidates: [] };

  it("verifies only when the registry names this same business and it is active", () => {
    expect(parseRegistry(found, facts).status).toBe("verified");
  });
  it("does not trust the service's own score: a different company is not a match", () => {
    const other = { match: { ...found.match, legal_name: "Lagos Heavy Industries Limited", match_score: 0.99 }, candidates: [] };
    const o = parseRegistry(other, facts);
    expect(o.status).toBe("unverified");
  });
  it("not finding the business is unverified, not failed: small suppliers are rarely in it", () => {
    expect(parseRegistry({ match: null, candidates: [] }, facts).status).toBe("unverified");
  });
  it("an inactive entity fails, an unclear status is not verified", () => {
    expect(parseRegistry({ match: { ...found.match, status: "INACTIVE" } }, facts).status).toBe("failed");
    expect(parseRegistry({ match: { ...found.match, status: undefined, registration: {} } }, facts).status).toBe("unverified");
  });
  it("finds the supplier among candidates", () => {
    const o = parseRegistry({ match: null, candidates: [{ legal_name: "Someone Else Ltd" }, { ...found.match }] }, facts);
    expect(o.status).toBe("verified");
  });
  it("an unreadable answer is unknown", () => {
    expect(parseRegistry({ hello: "world" }, facts).status).toBe("unknown");
    expect(parseRegistry(undefined, facts).status).toBe("unknown");
  });
  it("compares names without legal suffixes or punctuation", () => {
    expect(normaliseName("A&B Trading, Inc.")).toBe("a and b trading");
    expect(sameBusinessName("Ikeja Office Supply", "IKEJA OFFICE SUPPLY LIMITED")).toBe(true);
    expect(sameBusinessName("Ikeja Office Supply", "Ikeja Heavy Supply")).toBe(false);
    expect(sameBusinessName("", "anything")).toBe(false);
  });
});

describe("email deliverability", () => {
  const good = { email: "sales@x.example", syntaxValid: true, hasMx: true, disposable: false, role: false, freeProvider: false, risk: "low" };
  it("a deliverable address is verified, with the limit said out loud", () => {
    const o = parseEmail(good);
    expect(o.status).toBe("verified");
    expect(o.summary).toMatch(/does not prove the mailbox belongs/i);
  });
  it("an address that cannot receive mail fails; a throwaway one is not verified", () => {
    expect(parseEmail({ ...good, hasMx: false }).status).toBe("failed");
    expect(parseEmail({ ...good, syntaxValid: false }).status).toBe("failed");
    expect(parseEmail({ ...good, disposable: true }).status).toBe("unverified");
  });
  it("an unreadable answer is unknown", () => {
    expect(parseEmail({ risk: "low" }).status).toBe("unknown");
    expect(parseEmail(null).status).toBe("unknown");
  });
});

describe("how outcomes read once they are evidence", () => {
  const row = (evidenceType: "business_identity" | "contact_information", verificationStatus: "verified" | "failed" | "unverified") => ({ evidenceType, verificationStatus, expiresAt: null as Date | null });
  it("a clear sanctions screen plus a registry hit verifies identity; a sanctions hit overrides it", () => {
    expect(summariseEvidence([row("business_identity", "unverified"), row("business_identity", "verified")], new Date()).identityVerified).toBe(true);
    expect(summariseEvidence([row("business_identity", "failed"), row("business_identity", "verified")], new Date()).identityVerified).toBe(false);
    expect(summariseEvidence([row("business_identity", "unverified")], new Date()).identityVerified).toBeNull();
  });
  it("every check states what it cannot prove", () => {
    for (const id of VERIFY_CHECK_IDS) expect(VERIFY_CHECKS[id].limit.length).toBeGreaterThan(20);
  });
});

describe("payment keys", () => {
  const d = new Date("2026-11-04T10:00:00Z");
  it("the same payment on the same day has the same key, so a retry is never charged twice", () => {
    const a = paymentKey("s1", "sanctions", "https://x/y?name=a", null, d);
    expect(paymentKey("s1", "sanctions", "https://x/y?name=a", null, new Date("2026-11-04T23:59:00Z"))).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("a different supplier, input or day is a new payment", () => {
    const a = paymentKey("s1", "sanctions", "https://x/y?name=a", null, d);
    expect(paymentKey("s2", "sanctions", "https://x/y?name=a", null, d)).not.toBe(a);
    expect(paymentKey("s1", "sanctions", "https://x/y?name=b", null, d)).not.toBe(a);
    expect(paymentKey("s1", "sanctions", "https://x/y?name=a", null, new Date("2026-11-05T00:00:00Z"))).not.toBe(a);
  });
});

describe("paid calls through Passport", () => {
  const input = { url: "https://x402.tbs-digital.com/screen/entity?name=Acme", method: "GET" as const, sessionId: "sess_1", idempotencyKey: "11111111-1111-5111-8111-111111111111" };
  const success: KpassResult = {
    exitCode: 0,
    json: {
      status: "success", payment_requirement: { asset: "USDC", amount: "0.001" }, usage: { spent_total: "0.001", reserved_total: "0.00" },
      x402: { status_code: 200, response_body: "{}", parsed_response_body: { match_count: 0, matches: [] } },
    },
  };

  it("pays from the named session with the idempotency key, and passes nothing through a shell", async () => {
    let seen: string[] = [];
    setKpassExecutor(async (args) => { seen = args; return success; });
    const r = await paidCall({ ...input, method: "POST", body: { legal_name: "A'; rm -rf /" } });
    expect(r).toMatchObject({ ok: true, amount: "0.001", spentTotal: "0.001", statusCode: 200 });
    expect(seen.slice(0, 2)).toEqual(["session", "execute"]);
    expect(seen).toEqual(expect.arrayContaining(["--session-id", "sess_1", "--idempotency-key", input.idempotencyKey, "--method", "POST"]));
    expect(seen[seen.indexOf("--body") + 1]).toBe(JSON.stringify({ legal_name: "A'; rm -rf /" }));
    expect(seen).not.toContain("--use-allowance");
    setKpassExecutor();
  });

  it("an empty wallet is its own plain answer, and nothing was charged", () => {
    const r = readPaidResult({ exitCode: 6, json: { error_code: "wallet_empty" } });
    expect(r).toMatchObject({ ok: false, kind: "wallet_empty" });
    expect(!r.ok && r.message).toMatch(/Nothing was charged/);
  });

  it("limits, unusable sessions, pending and unsettled payments each map to their own kind", () => {
    expect(readPaidResult({ exitCode: 6, json: { error_code: "session_total_exceeded" } })).toMatchObject({ kind: "session_limit" });
    expect(readPaidResult({ exitCode: 6, json: { error_code: "separate_session_used_up" } })).toMatchObject({ kind: "session_limit" });
    expect(readPaidResult({ exitCode: 6, json: { error_code: "session_endpoint_forbidden" } })).toMatchObject({ kind: "session_unusable" });
    expect(readPaidResult({ exitCode: 7, json: { error_code: "payment_outcome_pending" } })).toMatchObject({ kind: "pending" });
    expect(readPaidResult({ exitCode: 7, json: { error_code: "payment_not_settled" } })).toMatchObject({ kind: "not_settled" });
    expect(readPaidResult({ exitCode: 2, json: { error_code: "no_payment_requirement" } })).toMatchObject({ kind: "service_error" });
    expect(readPaidResult({ exitCode: 1, json: null })).toMatchObject({ kind: "failed" });
    // Real CLI output for an unknown session: exit 3, which must not be reported as a sign-in problem.
    const gone = readPaidResult({ exitCode: 3, json: { error: "No active session found for the given session ID. Re-create and approve a session with 'kpass session create'.", status: "error" } });
    expect(gone).toMatchObject({ ok: false, kind: "session_unusable" });
    expect(readPaidResult({ exitCode: 3, json: { error: "Not logged in" } })).toMatchObject({ kind: "not_signed_in" });
  });

  it("a service error or an unreadable success is never treated as an answer", () => {
    const bad = (x402: unknown): KpassResult => ({ exitCode: 0, json: { x402 } });
    expect(readPaidResult(bad({ status_code: 500, response_body: "oops" }))).toMatchObject({ ok: false, kind: "service_error" });
    expect(readPaidResult(bad({ status_code: 200, response_body: "<html>" }))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(readPaidResult({ exitCode: 0, json: {} })).toMatchObject({ ok: false, kind: "unreadable" });
    expect(readPaidResult(bad({ status_code: 200, response_body: "{\"match_count\":0,\"matches\":[]}" }))).toMatchObject({ ok: true });
  });
});
