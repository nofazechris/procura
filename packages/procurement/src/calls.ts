/**
 * Phone calls to a seller, placed through StablePhone (stablephone.dev) and paid per call through Kite
 * Passport. Pure code with no network or database access, so the safety rules are unit tested.
 *
 * The rules: a call goes only to the number saved on the seller, in international format. The AI says
 * it is an AI, only asks questions, and never agrees to buy or gives payment details. The call is
 * not recorded. Nothing is dialled unless a person pressed the button after reading the script.
 */

/** What one call costs, from Kite's catalog, in USD. */
export const CALL_PRICE = "0.54";
export const CALL_URL = "https://stablephone.dev/api/call";
export const CALL_STATUS_URL = (callId: string) => `https://stablephone.dev/api/call/${encodeURIComponent(callId)}`;
/** The most minutes a call may run. */
export const CALL_MAX_MINUTES = 3;

/** "+234 801 234 5678" becomes "+2348012345678". Null unless it is a plausible international number. */
export function toE164(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s.startsWith("+")) return null;
  const digits = s.slice(1).replace(/[\s().-]/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** The last four digits, for the audit trail and the screen, never the whole number. */
export const phoneHint = (e164: string) => `ending ${e164.slice(-4)}`;

export interface CallScriptParts { opening: string; questions: string[]; mustConfirm: string[]; closing: string }

/** Every call opens by saying it is an AI, whatever the model drafted. */
export const AI_DISCLOSURE = "Hello, I am an AI assistant calling on behalf of a customer.";

/**
 * The instructions the calling AI receives. The safety rules come first and are fixed text, so a
 * drafted script can add questions but never take a rule away.
 */
export function buildCallTask(seller: string, script: CallScriptParts): string {
  const rules = [
    "You are an AI assistant making a short phone call on behalf of a customer, to ask a business about a possible purchase.",
    "At the very start, say plainly that you are an AI assistant calling for a customer. Never pretend to be a human.",
    "You only ask questions and write down the answers. You never agree to buy anything, never promise payment, and never give card, bank or account details.",
    "If asked to pay, commit or sign anything, say a person will follow up, then politely end the call.",
    "Be brief and polite. If the person does not want to talk, thank them and end the call.",
  ];
  const parts = [
    ...rules, "",
    `You are calling: ${seller.slice(0, 120)}.`,
    `Open with: ${script.opening}`,
    "Ask, one at a time:", ...script.questions.map((q, i) => `${i + 1}. ${q}`),
  ];
  if (script.mustConfirm.length) parts.push("Before ending, repeat back to confirm:", ...script.mustConfirm.map((m) => `- ${m}`));
  parts.push(`Close with: ${script.closing}`);
  return parts.join("\n").slice(0, 3000);
}

export function buildCallBody(phone: string, seller: string, script: CallScriptParts): Record<string, unknown> {
  return {
    phone_number: phone,
    task: buildCallTask(seller, script),
    first_sentence: AI_DISCLOSURE,
    max_duration: CALL_MAX_MINUTES,
    wait_for_greeting: true,
    record: false,
    voicemail_action: "hangup",
    metadata: "procura",
  };
}

/** True for the two StablePhone addresses a call may be sent to or read from. */
export function isCallUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "stablephone.dev" && (u.pathname === "/api/call" || /^\/api\/call\/[A-Za-z0-9._~%-]{1,100}$/.test(u.pathname));
  } catch { return false; }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Reads the answer to "start a call". Anything other than a clear success with a call id is not a placed call. */
export function parseCallStarted(body: unknown): { callId: string } | null {
  const b = rec(body);
  const id = str(b["call_id"]);
  return b["success"] === true && id && /^[A-Za-z0-9._~-]{1,100}$/.test(id) ? { callId: id } : null;
}

export interface CallStatus {
  status: string;
  completed: boolean;
  answeredBy: string | null;
  seconds: number | null;
  summary: string | null;
  transcript: string | null;
  error: string | null;
}

/** Reads the call's progress. Text from the other party is untrusted: it is capped and shown as plain text only. */
export function parseCallStatus(body: unknown): CallStatus | null {
  const b = rec(body);
  const status = str(b["status"]);
  if (!status) return null;
  const len = typeof b["call_length"] === "number" && Number.isFinite(b["call_length"]) ? Math.round(b["call_length"] * 60) : null;
  return {
    status: status.toLowerCase().slice(0, 40), completed: b["completed"] === true, answeredBy: str(b["answered_by"])?.slice(0, 40) ?? null,
    seconds: len !== null && len >= 0 && len < 7200 ? len : null,
    summary: str(b["summary"])?.slice(0, 1500) ?? null, transcript: str(b["transcript"])?.slice(0, 6000) ?? null,
    error: str(b["error_message"])?.slice(0, 300) ?? null,
  };
}
