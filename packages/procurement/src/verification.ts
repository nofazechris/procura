import type { EvidenceType, VerificationStatus } from "@procura/shared";

/**
 * Supplier verification: which paid checks exist, what they cost, how to call them, and how to read
 * their answers. Pure code with no network or database access, so every rule here is unit tested.
 *
 * The rules that matter:
 *  - An answer we cannot read is "unknown", never "verified".
 *  - Not finding a business in a registry is "unverified", not "failed": most small suppliers are not
 *    in the registry we can search, and absence is not evidence of fraud.
 *  - A possible sanctions match is "failed", because the safe default for a payment is to stop.
 *  - A service's own score is never trusted alone: the name it returns must also match the supplier.
 */

export const VERIFY_CHECK_IDS = ["sanctions", "registry", "email"] as const;
export type VerifyCheckId = (typeof VERIFY_CHECK_IDS)[number];

export interface VerifyCheckSpec {
  id: VerifyCheckId;
  label: string;
  /** What this check proves, in a sentence a buyer can read. */
  proves: string;
  /** What it cannot prove, shown next to the result so a pass is never over-read. */
  limit: string;
  evidenceType: EvidenceType;
  /** The listed price per call in USD. The paid call is refused by Passport if it costs more than the session allows. */
  price: string;
  sourceName: string;
  method: "GET" | "POST";
}

export const VERIFY_CHECKS: Record<VerifyCheckId, VerifyCheckSpec> = {
  sanctions: {
    id: "sanctions", label: "Sanctions screening", evidenceType: "business_identity", price: "0.001", method: "GET",
    sourceName: "Sanctions screening (OFAC and UN lists)",
    proves: "The name does not match anyone on the OFAC or UN sanctions lists.",
    limit: "A clear result does not prove the business is real. It only rules out a listed name.",
  },
  registry: {
    id: "registry", label: "Company registry", evidenceType: "business_identity", price: "0.01", method: "POST",
    sourceName: "GLEIF legal entity registry",
    proves: "A legal entity with this name is registered and active.",
    limit: "Only companies with a Legal Entity Identifier are listed. Many small, real businesses are not.",
  },
  email: {
    id: "email", label: "Email deliverability", evidenceType: "contact_information", price: "0.004", method: "GET",
    sourceName: "Email deliverability check",
    proves: "The contact email address is well formed, can receive mail and is not a throwaway domain.",
    limit: "It does not prove the mailbox belongs to the supplier.",
  },
};

export const VERIFY_HOSTS: Record<VerifyCheckId, string> = {
  sanctions: "https://x402.tbs-digital.com/screen/entity",
  registry: "https://api.oblique.markets/api/v1/paid/gleif-resolve",
  email: "https://toolcall.click/t/email/validate",
};

/** How long a check stays valid. After this the evidence reads as unknown again and can be refreshed. */
export const VERIFY_VALID_DAYS = 30;

export interface SupplierFacts {
  name: string;
  legalName?: string | null;
  countryCode?: string | null;
  email?: string | null;
}

export interface PlannedCheck {
  id: VerifyCheckId;
  price: string;
  /** False when the supplier is missing what the check needs. Nothing is bought for a check that cannot run. */
  ready: boolean;
  missing: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function plannedChecks(facts: SupplierFacts, wanted: readonly VerifyCheckId[] = VERIFY_CHECK_IDS): PlannedCheck[] {
  return VERIFY_CHECK_IDS.filter((id) => wanted.includes(id)).map((id) => {
    const spec = VERIFY_CHECKS[id];
    let missing: string | null = null;
    if (!(facts.legalName ?? facts.name).trim()) missing = "a name";
    else if (id === "email" && !(facts.email && EMAIL.test(facts.email.trim()))) missing = "a contact email address";
    else if (id === "registry" && !/^[A-Za-z]{2}$/.test((facts.countryCode ?? "").trim())) missing = "a two-letter country code";
    return { id, price: spec.price, ready: missing === null, missing };
  });
}

/** Sum of the prices of the checks that will actually run, as an exact decimal string with six places. */
export function estimateCost(plan: readonly PlannedCheck[]): string {
  const micro = plan.filter((p) => p.ready).reduce((sum, p) => sum + toMicro(p.price), 0n);
  return fromMicro(micro);
}

function toMicro(v: string): bigint {
  const [w = "0", f = ""] = v.split(".");
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6));
}
function fromMicro(n: bigint): string {
  const w = n / 1_000_000n, f = (n % 1_000_000n).toString().padStart(6, "0");
  return `${w}.${f}`;
}
/** Compare two decimal strings exactly. */
export function costExceeds(a: string, b: string): boolean { return toMicro(a) > toMicro(b); }

export interface PaidCall { method: "GET" | "POST"; url: string; body?: Record<string, unknown> }

export function buildCall(id: VerifyCheckId, facts: SupplierFacts): PaidCall {
  const name = (facts.legalName ?? facts.name).trim().slice(0, 200);
  switch (id) {
    case "sanctions": return { method: "GET", url: `${VERIFY_HOSTS.sanctions}?${new URLSearchParams({ name })}` };
    case "email": return { method: "GET", url: `${VERIFY_HOSTS.email}?${new URLSearchParams({ email: (facts.email ?? "").trim() })}` };
    case "registry": return { method: "POST", url: VERIFY_HOSTS.registry, body: { legal_name: name, country: (facts.countryCode ?? "").trim().toUpperCase(), candidates: true } };
  }
}

export interface CheckOutcome {
  status: VerificationStatus;
  /** One plain sentence for the page. */
  summary: string;
  /** The few fields worth keeping. Never the whole reply. */
  data: Record<string, unknown>;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const UNREADABLE = (what: string): CheckOutcome => ({ status: "unknown", summary: `${what} answered in a form Procura could not read, so nothing is recorded as verified.`, data: {} });

export function parseSanctions(body: unknown): CheckOutcome {
  const b = rec(body);
  const count = num(b["match_count"]);
  if (count === null || !Array.isArray(b["matches"])) return UNREADABLE("The sanctions screen");
  const matches = (b["matches"] as unknown[]).map(rec);
  if (count === 0 && matches.length === 0) {
    return { status: "unverified", summary: "No match on the OFAC or UN sanctions lists. This rules out a listed name; it does not prove the business is real.", data: { match_count: 0 } };
  }
  // Any listed match stops the check. Names are fuzzy, so a person decides; the payment does not go ahead meanwhile.
  const top = matches[0] ?? {};
  const where = str(top["list"]), who = str(top["name"]);
  return {
    status: "failed",
    summary: `Possible sanctions match${who ? `: ${who}` : ""}${where ? ` on ${where}` : ""}. Review it before any payment.`,
    data: { match_count: count, top: { name: who, list: where, score: num(top["score"]) } },
  };
}

const LEGAL_SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|llp|plc|gmbh|sa|ag|bv|nv|pty|pte|oy|ab|as|srl|spa)\b/g;
export function normaliseName(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
    .replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

/** True when the two names are the same business name once punctuation and legal suffixes are removed. */
export function sameBusinessName(a: string, b: string): boolean {
  const x = normaliseName(a), y = normaliseName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  const shared = [...tx].filter((t) => ty.has(t)).length;
  return shared / Math.max(tx.size, ty.size) >= 0.75;
}

const ACTIVE = /^(active|issued)$/i;
const INACTIVE = /^(inactive|dissolved|retired|annulled|merged|liquidated|struck[- ]?off|lapsed)$/i;

export function parseRegistry(body: unknown, facts: SupplierFacts): CheckOutcome {
  const b = rec(body);
  const candidates = Array.isArray(b["candidates"]) ? (b["candidates"] as unknown[]).map(rec) : [];
  const match = rec(b["match"]);
  const hasMatch = str(match["legal_name"]) !== null;
  if (!hasMatch && !("match" in b) && !Array.isArray(b["candidates"])) return UNREADABLE("The registry");
  const asked = (facts.legalName ?? facts.name).trim();

  // The registry names what it found; we only accept it when that is the supplier's own name.
  const pool = hasMatch ? [match, ...candidates] : candidates;
  const hit = pool.find((c) => { const n = str(c["legal_name"]); return n !== null && sameBusinessName(asked, n); });
  if (!hit) {
    return {
      status: "unverified",
      summary: "No registry record with this name. Many small, real businesses are not in this registry, so this is unknown rather than a failure.",
      data: { searched: asked, candidates: pool.length },
    };
  }
  const name = str(hit["legal_name"])!;
  const status = str(hit["status"]) ?? str(rec(hit["registration"])["status"]);
  const data = { legal_name: name, lei: str(hit["lei"]), status, jurisdiction: str(hit["jurisdiction"]), authority: str(rec(hit["registration"])["authority_id"]) };
  if (status && INACTIVE.test(status)) {
    return { status: "failed", summary: `${name} is in the registry but is not active (${status.toLowerCase()}).`, data };
  }
  if (status && ACTIVE.test(status)) {
    return { status: "verified", summary: `${name} is registered and active.`, data };
  }
  return { status: "unverified", summary: `${name} is in the registry, but its status was not clear, so it is not recorded as verified.`, data };
}

export function parseEmail(body: unknown): CheckOutcome {
  const b = rec(body);
  if (typeof b["syntaxValid"] !== "boolean" || typeof b["hasMx"] !== "boolean") return UNREADABLE("The email check");
  const data = { syntaxValid: b["syntaxValid"], hasMx: b["hasMx"], disposable: b["disposable"] === true, role: b["role"] === true, freeProvider: b["freeProvider"] === true, risk: str(b["risk"]) };
  if (!b["syntaxValid"] || !b["hasMx"]) return { status: "failed", summary: "This email address cannot receive mail.", data };
  if (b["disposable"] === true) return { status: "unverified", summary: "This is a throwaway email domain, so it is not recorded as verified.", data };
  const notes = [b["freeProvider"] === true ? "a free mailbox provider" : null, b["role"] === true ? "a shared role address" : null].filter(Boolean);
  return { status: "verified", summary: `This email address can receive mail${notes.length ? ` (${notes.join(", ")})` : ""}. It does not prove the mailbox belongs to the supplier.`, data };
}

export function parseOutcome(id: VerifyCheckId, body: unknown, facts: SupplierFacts): CheckOutcome {
  return id === "sanctions" ? parseSanctions(body) : id === "registry" ? parseRegistry(body, facts) : parseEmail(body);
}

/** A paid call is only ever made to one of the services above, over https. */
export function isVerifyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && Object.values(VERIFY_HOSTS).some((h) => { const b = new URL(h); return u.origin === b.origin && u.pathname === b.pathname; });
  } catch { return false; }
}
