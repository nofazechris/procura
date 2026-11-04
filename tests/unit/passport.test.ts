import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildDelegation, evaluateSessionRequest, MAX_SESSION_TTL_SECONDS, type SessionPolicyContext, type SessionRequestInput } from "@procura/policies/core";
import {
  approvalStatus, parseFirstJson, assertPassportEnabled, passportEnabledFor, passportStatus, registerAgent, requestSession, setKpassExecutor, type KpassResult,
} from "../../apps/web/lib/server/passport";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://x/y";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
  process.env.PASSPORT_HOME = "C:/passport-home";
  process.env.PASSPORT_BUSINESS_ID = BUSINESS;
});
afterEach(() => setKpassExecutor());

/* ---------------- the rules ---------------- */

const ctx: SessionPolicyContext = { currency: "USD", maxTransactionAmount: "2500.00", maxTotalSpend: "20000.00", spentThisPeriod: "19000.00" };
const req = (over: Partial<SessionRequestInput> = {}): SessionRequestInput => ({ taskSummary: "Buy verification lookups", maxPerTx: "1", maxTotal: "5", ttlSeconds: 3600, ...over });

describe("evaluateSessionRequest: a session may never be wider than the business policy", () => {
  it("allows a request inside the policy and reports what is left", () => {
    const d = evaluateSessionRequest(ctx, req());
    expect(d).toMatchObject({ allowed: true, rejections: [] });
    expect(d.maxTotalAllowed).toBe("1000.00");
    expect(d.maxPerTxAllowed).toBe("1000.00");
  });

  it("refuses more per payment than the policy's maximum single purchase", () => {
    expect(evaluateSessionRequest({ ...ctx, spentThisPeriod: "0" }, req({ maxPerTx: "2500.01", maxTotal: "3000" })).rejections).toContain("PER_TX_EXCEEDS_POLICY");
    expect(evaluateSessionRequest({ ...ctx, spentThisPeriod: "0" }, req({ maxPerTx: "2500", maxTotal: "3000" })).allowed).toBe(true);
  });

  it("refuses a total larger than what is left of this period's budget", () => {
    expect(evaluateSessionRequest(ctx, req({ maxPerTx: "10", maxTotal: "1000.01" })).rejections).toContain("TOTAL_EXCEEDS_REMAINING_BUDGET");
    expect(evaluateSessionRequest(ctx, req({ maxPerTx: "10", maxTotal: "1000" })).allowed).toBe(true);
    const spentAll = evaluateSessionRequest({ ...ctx, spentThisPeriod: "25000" }, req());
    expect(spentAll.rejections).toContain("TOTAL_EXCEEDS_REMAINING_BUDGET");
    expect(spentAll.maxTotalAllowed).toBe("0.00");
  });

  it("refuses a per-payment limit above the total, and bad amounts or durations", () => {
    expect(evaluateSessionRequest(ctx, req({ maxPerTx: "6", maxTotal: "5" })).rejections).toContain("PER_TX_EXCEEDS_TOTAL");
    for (const bad of ["0", "-1", "abc", "", "1e3", "1,000"]) {
      expect(evaluateSessionRequest(ctx, req({ maxPerTx: bad })).rejections).toContain("INVALID_AMOUNT");
    }
    expect(evaluateSessionRequest(ctx, req({ ttlSeconds: 60 })).rejections).toContain("TTL_OUT_OF_RANGE");
    expect(evaluateSessionRequest(ctx, req({ ttlSeconds: MAX_SESSION_TTL_SECONDS + 1 })).rejections).toContain("TTL_OUT_OF_RANGE");
    expect(evaluateSessionRequest(ctx, req({ ttlSeconds: 90.5 })).rejections).toContain("TTL_OUT_OF_RANGE");
    expect(evaluateSessionRequest(ctx, req({ taskSummary: "   " })).rejections).toContain("SUMMARY_REQUIRED");
  });

  it("reports every problem at once", () => {
    const d = evaluateSessionRequest(ctx, req({ taskSummary: "", maxPerTx: "5000", maxTotal: "4000", ttlSeconds: 1 }));
    expect(d.rejections).toEqual(expect.arrayContaining(["SUMMARY_REQUIRED", "TTL_OUT_OF_RANGE", "PER_TX_EXCEEDS_POLICY", "TOTAL_EXCEEDS_REMAINING_BUDGET"]));
  });

  it("is unavailable to a business that is not in USD, because no exchange rate is ever guessed", () => {
    expect(evaluateSessionRequest({ ...ctx, currency: "NGN" }, req())).toMatchObject({ allowed: false, rejections: ["CURRENCY_UNSUPPORTED"] });
  });

  it("builds the delegation Passport enforces, with the caps and expiry as given", () => {
    expect(buildDelegation(req({ taskSummary: "  Buy lookups  " }))).toEqual({
      task: { summary: "Buy lookups" },
      payment_policy: { max_amount_per_tx: "1", max_total_amount: "5", ttl_seconds: 3600, currency: "USD" },
    });
    expect(buildDelegation(req({ taskSummary: "x".repeat(500) })).task.summary).toHaveLength(300);
  });
});

/* ---------------- the adapter, against a fake CLI ---------------- */

const fake = (handler: (args: string[]) => KpassResult | Promise<KpassResult>) => {
  const calls: string[][] = [];
  setKpassExecutor(async (args) => { calls.push(args); return handler(args); });
  return calls;
};
const okJson = (json: Record<string, unknown>): KpassResult => ({ exitCode: 0, json });

describe("passport adapter", () => {
  it("only serves the one business it is enabled for", () => {
    expect(passportEnabledFor(BUSINESS)).toBe(true);
    expect(passportEnabledFor(OTHER)).toBe(false);
    expect(() => assertPassportEnabled(BUSINESS)).not.toThrow();
    expect(() => assertPassportEnabled(OTHER)).toThrowError(/not enabled for this business/);
  });

  it("registers an agent and returns only the identity fields", async () => {
    const calls = fake(() => okJson({ agent_id: "agent_1", owner_id: "user_1", type: "procura-agent", token: "SECRET-TOKEN" }));
    const a = await registerAgent("procura-agent");
    expect(a).toEqual({ agentId: "agent_1", ownerId: "user_1", type: "procura-agent" });
    expect(JSON.stringify(a)).not.toMatch(/SECRET/);
    expect(calls[0]).toEqual(["agent:register", "--type", "procura-agent"]);
  });

  it("passes the delegation as a single argument, so a hostile task description cannot become a command", async () => {
    const calls = fake(() => okJson({ request_id: "req_1", approval_url: "https://app.gokite.ai/approve/req_1", expires_at: "2026-11-04T12:00:00Z" }));
    const hostile = buildDelegation(req({ taskSummary: "$(rm -rf ~) `whoami` ; echo pwned' \" && curl evil" }));
    const r = await requestSession(hostile);
    expect(r).toEqual({ requestId: "req_1", approvalUrl: "https://app.gokite.ai/approve/req_1", expiresAt: "2026-11-04T12:00:00Z" });
    const args = calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["session", "create", "--separate", "--no-browser"]));
    const given = args[args.indexOf("--delegation") + 1]!;
    expect(JSON.parse(given).task.summary).toContain("$(rm -rf ~)");
    expect(args.filter((a) => a.includes("rm -rf"))).toHaveLength(1);
  });

  it("refuses an approval link that is not on Passport's own site, or not https", async () => {
    for (const url of ["https://evil.example/approve", "http://app.gokite.ai/approve", "https://gokite.ai.evil.example/x", "javascript:alert(1)", "not a url"]) {
      fake(() => okJson({ request_id: "req_1", approval_url: url }));
      await expect(requestSession(buildDelegation(req()))).rejects.toMatchObject({ code: "PASSPORT_FAILED" });
    }
    fake(() => okJson({ request_id: "req_1", approval_url: "https://agentpassport.ai/approve/1" }));
    await expect(requestSession(buildDelegation(req()))).resolves.toMatchObject({ requestId: "req_1" });
  });

  it("reads Passport's real answers: approved, pending and expired", async () => {
    const state = async (json: Record<string, unknown> | null, exitCode = 0) => { fake(() => ({ exitCode, json })); return approvalStatus("req_1"); };
    // Real responses captured from `kpass session status`.
    const approved = { status: "success", request_id: "req_1", session_id: "sess_1", session: { id: "sess_1", status: "active", expires_at: "2026-11-04T14:06:53Z" } };
    expect(await state(approved)).toMatchObject({ state: "approved", sessionId: "sess_1", expiresAt: "2026-11-04T14:06:53Z" });
    const expired = { status: "error", error: "Session request expired before approval." };
    expect(await state(expired, 3)).toMatchObject({ state: "expired" });
    expect(await state({ status: "error", error: "Session request expired before the user approved it." }, 3)).toMatchObject({ state: "expired" });
    expect(await state({ status: "human_action_required" })).toMatchObject({ state: "pending" });
    expect(await state({ status: "rejected" })).toMatchObject({ state: "rejected" });
  });

  it("never reports approval without positive evidence", async () => {
    const state = async (json: Record<string, unknown> | null, exitCode = 0) => { fake(() => ({ exitCode, json })); return approvalStatus("req_1"); };
    expect(await state({ status: "success" })).toMatchObject({ state: "unknown" });
    expect(await state({ status: "success", session: { status: "active" } })).toMatchObject({ state: "unknown" }); // no session id
    expect(await state({ status: "success", session: { id: "s", status: "expired" } })).toMatchObject({ state: "unknown" });
    expect(await state({ status: "approved", session: { id: "s", status: "active" }, error: "boom" }, 3)).toMatchObject({ state: "unknown" });
    expect(await state({ status: "success", session: { id: "s", status: "active" } }, 4)).toMatchObject({ state: "unknown" });
    fake(() => ({ exitCode: 1, json: { status: "success", session: { id: "s", status: "active" } } }));
    await expect(approvalStatus("req_1")).rejects.toMatchObject({ code: "PASSPORT_FAILED" });
    expect(await state(null)).toMatchObject({ state: "unknown" });
  });

  it("reads the first JSON object even when the CLI prints two", () => {
    const first = { error: "Session request expired before approval.", status: "error" };
    const two = `${JSON.stringify(first, null, 1)}
${JSON.stringify({ error: 'second {object} with " quote', status: "error" }, null, 1)}
`;
    expect(parseFirstJson(two)).toEqual({ error: "Session request expired before approval.", status: "error" });
    expect(parseFirstJson('{"a":"}{"}')).toEqual({ a: "}{" });
    expect(parseFirstJson("no json here")).toBeNull();
    expect(parseFirstJson('{"unterminated": ')).toBeNull();
  });

  it("turns CLI failures into safe errors", async () => {
    for (const [exitCode, code] of [[3, "PASSPORT_NOT_SIGNED_IN"], [5, "PASSPORT_RATE_LIMITED"], [2, "PASSPORT_BAD_REQUEST"], [1, "PASSPORT_FAILED"]] as const) {
      fake(() => ({ exitCode, json: { error: "internal detail jwt=abc", error_code: "x" } }));
      const err = await registerAgent("procura-agent").catch((e: Error) => e);
      expect(err).toMatchObject({ code });
      expect((err as Error).message).not.toMatch(/jwt|internal detail/);
    }
    fake(() => okJson({}));
    await expect(registerAgent("procura-agent")).rejects.toMatchObject({ code: "PASSPORT_FAILED" });
  });

  it("reports status without exposing the owner's email or any token", async () => {
    fake((args) => {
      const key = args.join(" ");
      if (key === "status") return okJson({ user: { logged_in: true, email: "chris@example.com", jwt: "SECRET" }, backend: { reachable: true } });
      if (key === "health") return okJson({ backend_env: "prod" });
      if (key === "allowance status") return okJson({ state: "none" });
      if (key === "wallet balance") return okJson({ assets: [{ asset: "USDC", total: "0.00" }] });
      if (key === "wallet address") return okJson({ wallets: [{ address: "0xbase", chain: "base" }, { address: "0xabc", chain: "kite" }] });
      return { exitCode: 1, json: null };
    });
    const s = await passportStatus();
    expect(s).toMatchObject({ loggedIn: true, backendEnv: "prod", allowance: "none", ownerHint: "c***@example.com", wallet: { address: "0xabc", usdcTotal: "0.00" } });
    expect(JSON.stringify(s)).not.toMatch(/SECRET|chris@/);
  });
});
