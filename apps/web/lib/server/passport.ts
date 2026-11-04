import { execFile } from "node:child_process";
import { ServiceError } from "@procura/shared";
import { serverEnv } from "../env";

/**
 * Kite Passport adapter. Passport has no public HTTP API: the `kpass` CLI is the only way in
 * (https://docs.gokite.ai/reference/kpass-cli). This module runs it as a child process.
 *
 * Safety:
 * - `execFile` with an argument array and no shell, so nothing in a task description or an id can be
 *   interpreted as a command.
 * - The CLI keeps a login token in PASSPORT_HOME/.kite-passport. We never read, log or return it;
 *   only fields we pick out of the JSON are passed on.
 * - One login serves one business (PASSPORT_BUSINESS_ID), so a second tenant cannot drive it.
 * - Nothing here moves money. It registers an agent identity and asks a person to approve a limited
 *   session; the approval itself is a passkey step Procura cannot perform or fake.
 */

export interface KpassResult { exitCode: number; json: Record<string, unknown> | null }
export type KpassExecutor = (args: string[]) => Promise<KpassResult>;

const TIMEOUT_MS = 45_000;

/**
 * The CLI prints JSON on stdout, and on some errors prints two objects back to back. Read the first
 * complete object, respecting strings, so an error response is never lost to a parse failure.
 */
export function parseFirstJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>; } catch { return null; }
    }
  }
  return null;
}

const defaultExecutor: KpassExecutor = (args) => {
  const env = serverEnv();
  return new Promise((resolve, reject) => {
    execFile(
      env.KPASS_BIN, [...args, "--output", "json", "--no-interactive"],
      { cwd: env.PASSPORT_HOME, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1_000_000, env: { ...process.env, KPASS_NO_UPDATE_CHECK: "1" } },
      (err, stdout) => {
        const json = parseFirstJson(stdout);
        if (!err) return resolve({ exitCode: 0, json });
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return reject(new ServiceError("PASSPORT_NOT_INSTALLED", "The kpass CLI is not installed on this server.", 503));
        if ((err as { killed?: boolean }).killed) return reject(new ServiceError("PASSPORT_TIMEOUT", "Kite Passport did not answer in time.", 504));
        // The CLI reports errors as JSON on stdout with a non-zero exit code.
        resolve({ exitCode: typeof code === "number" ? code : 1, json });
      },
    );
  });
};

let executor: KpassExecutor = defaultExecutor;
/** Tests swap in a fake CLI. Pass nothing to restore the real one. */
export function setKpassExecutor(e?: KpassExecutor): void {
  executor = e ?? defaultExecutor;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Runs a command and turns the CLI's failure codes into errors a person can act on. */
async function run(args: string[], allowCodes: number[] = []): Promise<KpassResult> {
  if (!serverEnv().PASSPORT_HOME) throw new ServiceError("PASSPORT_NOT_CONFIGURED", "Kite Passport is not configured on this server.", 503);
  const r = await executor(args);
  if (r.exitCode === 0 || allowCodes.includes(r.exitCode)) return r;
  const code = str(r.json?.["error_code"]);
  if (r.exitCode === 3) throw new ServiceError("PASSPORT_NOT_SIGNED_IN", "The Passport account on this server is not signed in.", 503);
  if (r.exitCode === 5) throw new ServiceError("PASSPORT_RATE_LIMITED", "Kite Passport is rate limiting requests. Try again shortly.", 429);
  if (r.exitCode === 2) throw new ServiceError("PASSPORT_BAD_REQUEST", "Kite Passport rejected the request.", 422, code ? { code } : undefined);
  console.error("[passport] kpass exit", r.exitCode, code ?? "");
  throw new ServiceError("PASSPORT_FAILED", "Kite Passport could not complete that. Try again in a moment.", 502);
}

/** Whether this business may use the server's single Passport login. */
export function passportEnabledFor(businessId: string): boolean {
  const env = serverEnv();
  return Boolean(env.PASSPORT_HOME && env.PASSPORT_BUSINESS_ID && env.PASSPORT_BUSINESS_ID === businessId);
}

export function assertPassportEnabled(businessId: string): void {
  const env = serverEnv();
  if (!env.PASSPORT_HOME) throw new ServiceError("PASSPORT_NOT_CONFIGURED", "Kite Passport is not configured on this server.", 503);
  if (env.PASSPORT_BUSINESS_ID !== businessId) {
    throw new ServiceError("PASSPORT_NOT_ENABLED", "Kite Passport is not enabled for this business.", 403);
  }
}

export interface PassportStatus {
  loggedIn: boolean;
  /** "prod" means real money. Shown to the person before they approve anything. */
  backendEnv: string | null;
  backendReachable: boolean;
  /** First letter and domain only, so the owner can recognise the account without exposing the address. */
  ownerHint: string | null;
  allowance: "none" | "active" | "unknown";
  wallet: { address: string | null; usdcTotal: string | null };
}

const maskEmail = (e: string) => e.replace(/^(.).*(@.+)$/, "$1***$2");

export async function passportStatus(): Promise<PassportStatus> {
  const [status, health, allowance, balance, address] = await Promise.all([
    run(["status"]), run(["health"], [1]), run(["allowance", "status"], [3, 4]),
    run(["wallet", "balance"], [3, 4]), run(["wallet", "address"], [3, 4]),
  ]);
  const user = rec(status.json?.["user"]);
  const loggedIn = user["logged_in"] === true;
  const email = str(user["email"]);

  const total = rec(Array.isArray(balance.json?.["assets"]) ? (balance.json!["assets"] as unknown[]).find((a) => rec(a)["asset"] === "USDC") : null);
  const wallets = Array.isArray(address.json?.["wallets"]) ? (address.json!["wallets"] as unknown[]) : [];
  // One EVM address serves every chain; prefer the Kite entry, fall back to the first wallet listed.
  const addr = str(rec(wallets.find((w) => rec(w)["chain"] === "kite") ?? wallets[0])["address"]);

  const state = str(allowance.json?.["state"]);
  return {
    loggedIn,
    backendEnv: str(health.json?.["backend_env"]),
    backendReachable: rec(status.json?.["backend"])["reachable"] === true,
    ownerHint: email ? maskEmail(email) : null,
    allowance: state === "none" ? "none" : state ? "active" : "unknown",
    wallet: { address: addr, usdcTotal: str(total["total"]) },
  };
}

export interface RegisteredAgent { agentId: string; ownerId: string; type: string }

/** Registers (or re-reads) Procura's agent identity under the signed-in Passport owner. Idempotent. */
export async function registerAgent(type: string): Promise<RegisteredAgent> {
  const r = await run(["agent:register", "--type", type]);
  const agentId = str(r.json?.["agent_id"]), ownerId = str(r.json?.["owner_id"]);
  if (!agentId || !ownerId) throw new ServiceError("PASSPORT_FAILED", "Kite Passport did not return an agent identity.", 502);
  return { agentId, ownerId, type: str(r.json?.["type"]) ?? type };
}

export interface SessionRequest { requestId: string; approvalUrl: string; expiresAt: string | null }

/**
 * Asks Passport for a separate spending session with these limits. This creates an approval
 * request only: nothing can be spent until a person approves it with their passkey on Passport.
 */
export async function requestSession(delegation: object): Promise<SessionRequest> {
  const r = await run([
    "session", "create", "--delegation", JSON.stringify(delegation), "--separate", "--reason", "allowance_unavailable", "--no-browser",
  ]);
  const requestId = str(r.json?.["request_id"]);
  const approvalUrl = str(r.json?.["approval_url"]);
  if (!requestId || !approvalUrl) throw new ServiceError("PASSPORT_FAILED", "Kite Passport did not return an approval link.", 502);
  // The link must be on Passport's own site, never a host a compromised response could substitute.
  let host = "";
  try { host = new URL(approvalUrl).protocol === "https:" ? new URL(approvalUrl).hostname : ""; } catch { host = ""; }
  if (!/(^|\.)(gokite\.ai|agentpassport\.ai)$/.test(host)) {
    throw new ServiceError("PASSPORT_FAILED", "Kite Passport returned an unexpected approval link.", 502);
  }
  return { requestId, approvalUrl, expiresAt: str(r.json?.["expires_at"]) };
}

export type ApprovalState = "pending" | "approved" | "rejected" | "expired" | "unknown";
export interface ApprovalStatus { state: ApprovalState; sessionId: string | null; expiresAt: string | null; raw: string | null }

/**
 * Reads, without waiting, whether the person has approved a session request.
 *
 * "Approved" needs positive evidence: the CLI succeeded AND reports a session whose own status is
 * "active". A failure is read for expiry or rejection, and never for approval, because Passport's
 * expiry message contains the word "approved" ("expired before the user approved it").
 */
export async function approvalStatus(requestId: string): Promise<ApprovalStatus> {
  const r = await run(["session", "status", "--request-id", requestId], [3, 4]);
  const session = rec(r.json?.["session"]);
  const sessionId = str(r.json?.["session_id"]) ?? str(session["id"]);
  const raw = str(session["status"]) ?? str(r.json?.["status"]);
  const base = { sessionId, expiresAt: str(session["expires_at"]) ?? str(r.json?.["expires_at"]), raw };
  const error = (str(r.json?.["error"]) ?? "").toLowerCase();

  let state: ApprovalState = "unknown";
  if (r.exitCode !== 0 || error) {
    if (/expire/.test(error)) state = "expired";
    else if (/reject|denied|declined/.test(error)) state = "rejected";
  } else if (session["status"] === "active" && sessionId) {
    state = "approved";
  } else {
    const s = (str(r.json?.["status"]) ?? "").toLowerCase();
    if (/pending|await|human_action|requested/.test(s)) state = "pending";
    else if (s === "rejected" || s === "denied") state = "rejected";
    else if (s === "expired") state = "expired";
  }
  return { state, ...base };
}

/* ------------------------------------------------------------------ */
/* Shopping: product search through Passport (free, no session needed) */
/* ------------------------------------------------------------------ */

export interface ShopListing {
  /** The retailer's product id (an Amazon ASIN). */
  id: string;
  title: string;
  /** A decimal USD price such as "19.99". Listings without a single clear price are dropped. */
  price: string;
  rating: number | null;
  reviews: number | null;
  /** The canonical product page, rebuilt from the id so no tracking or redirect link is ever used. */
  link: string;
}

const ASIN = /^[A-Z0-9]{10}$/;

/** "$1,299.00" becomes "1299.00". A range, a non-dollar price or anything odd returns null. */
export function parseUsdPrice(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const value = `${m[1]!.replace(/,/g, "")}.${(m[2] ?? "").padEnd(2, "0")}`;
  return /[1-9]/.test(value) ? value : null;
}

/** Reads Passport's search result. Every field is checked; a listing that does not hold up is skipped. */
export function parseShopListings(json: Record<string, unknown> | null): ShopListing[] {
  const items = Array.isArray(json?.["items"]) ? (json["items"] as unknown[]) : [];
  const out: ShopListing[] = [];
  for (const raw of items) {
    const it = rec(raw);
    const id = str(it["external_identifier"]);
    const title = str(it["title"]);
    const price = parseUsdPrice(it["price"]);
    if (str(it["provider"]) !== "amazon" || !id || !ASIN.test(id) || !title || !price) continue;
    const rating = typeof it["rating"] === "number" && it["rating"] >= 0 && it["rating"] <= 5 ? it["rating"] : null;
    const reviews = typeof it["reviews"] === "number" && Number.isInteger(it["reviews"]) && it["reviews"] >= 0 ? it["reviews"] : null;
    out.push({ id, title: title.replace(/\s+/g, " ").trim().slice(0, 300), price, rating, reviews, link: `https://www.amazon.com/dp/${id}` });
  }
  return out;
}

/** Searches Amazon through Passport. Reads only: nothing is added to a cart and nothing is spent. */
export async function shopSearch(query: string, max = 6): Promise<ShopListing[]> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!q) return [];
  const r = await run(["shop:search", "--query", q, "--max-results", String(Math.min(20, Math.max(1, max)))], [4]);
  return parseShopListings(r.json);
}

/* ------------------------------------------------------------------ */
/* Paid calls: spend from an approved session, one service call at a time */
/* ------------------------------------------------------------------ */

export interface PaidCallInput {
  url: string; method: "GET" | "POST"; body?: Record<string, unknown>;
  /** The Passport session to pay from. A paid call never falls back to the account allowance. */
  sessionId: string;
  /** The same key for the same payment, so a retry or a double click can never be charged twice. */
  idempotencyKey: string;
}

export type PaidFailure =
  | "wallet_empty" | "session_limit" | "session_unusable" | "not_signed_in" | "pending" | "not_settled" | "service_error" | "unreadable" | "failed";

export type PaidCallResult =
  | { ok: true; statusCode: number; body: unknown; amount: string | null; spentTotal: string | null }
  | { ok: false; kind: PaidFailure; code: string | null; message: string };

const fail = (kind: PaidFailure, code: string | null, message: string): PaidCallResult => ({ ok: false, kind, code, message });

/** Turns the CLI's answer to `session execute` into a result. Every failure code the CLI documents has its own plain message. */
export function readPaidResult(r: KpassResult): PaidCallResult {
  const code = str(r.json?.["error_code"]);
  if (r.exitCode !== 0) {
    // The CLI reports an unknown or finished session as an auth error (exit 3), so read the message before blaming the login.
    if (r.exitCode === 3) {
      return /session/i.test(str(r.json?.["error"]) ?? "")
        ? fail("session_unusable", code, "Kite Passport no longer has this session active. Ask for a new spending session. Nothing was charged.")
        : fail("not_signed_in", code, "The Passport account on this server is not signed in.");
    }
    if (code === "wallet_empty") return fail("wallet_empty", code, "The Passport wallet has no funds for this call. Nothing was charged.");
    if (code && /^session_(rule|total)_exceeded$|^separate_session_used_up$|^payment_cap_exceeded$/.test(code)) {
      return fail("session_limit", code, "This session's limit does not cover the call. Nothing was charged.");
    }
    if (code === "insufficient_balance") return fail("wallet_empty", code, "The Passport wallet does not have enough funds for this call. Nothing was charged.");
    if (code && /^session_/.test(code)) return fail("session_unusable", code, "This spending session cannot be used for this call.");
    if (code === "payment_outcome_pending" || code === "recurring_payment_unknown") {
      return fail("pending", code, "A payment may have gone through and is being checked. Nothing new was charged. Try the same check again in a minute.");
    }
    if (code === "payment_not_settled") return fail("not_settled", code, "The payment did not settle and was not charged. You can run the check again.");
    if (r.exitCode === 4 || code === "merchant_unsupported" || code === "merchant_not_allowed" || code === "no_payment_requirement") {
      return fail("service_error", code, "The verification service could not take this payment. Nothing was charged.");
    }
    return fail("failed", code, "Kite Passport could not complete the call.");
  }
  const x = rec(r.json?.["x402"]);
  const statusCode = num(x["status_code"]);
  if (statusCode === null) return fail("unreadable", null, "Kite Passport answered in a form Procura could not read.");
  if (statusCode < 200 || statusCode >= 300) return fail("service_error", null, `The verification service answered with an error (${statusCode}).`);
  let body: unknown = x["parsed_response_body"];
  if (body === undefined && typeof x["response_body"] === "string") { try { body = JSON.parse(x["response_body"]); } catch { body = undefined; } }
  if (body === undefined) return fail("unreadable", null, "The verification service answered with something that is not data.");
  const paid = rec(r.json?.["payment_requirement"]);
  return { ok: true, statusCode, body, amount: str(paid["amount"]), spentTotal: str(rec(r.json?.["usage"])["spent_total"]) };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Makes one paid call from a given session. This is the only place Procura asks Passport to spend. */
export async function paidCall(input: PaidCallInput): Promise<PaidCallResult> {
  const args = ["session", "execute", "--url", input.url, "--method", input.method, "--session-id", input.sessionId, "--idempotency-key", input.idempotencyKey];
  if (input.body) args.push("--body", JSON.stringify(input.body));
  const r = await run(args, [1, 2, 3, 4, 6, 7]);
  return readPaidResult(r);
}
