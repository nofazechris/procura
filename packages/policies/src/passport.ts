import { compare, money, subtract } from "@procura/shared";

/**
 * Rules for the spending session Procura asks Kite Passport for. Passport enforces its own caps; this
 * is Procura's side: a session may never be wider than the business's own spending policy, so the
 * person approving the passkey is only ever shown limits the business already allows.
 *
 * Passport denominates caps in USD and Procura has no exchange-rate feed, so sessions are only
 * available to businesses whose policy currency is USD. Pure and deterministic: no I/O.
 */

const DECIMAL = /^\d+(\.\d{1,6})?$/;

export const PASSPORT_CURRENCY = "USD";
export const MIN_SESSION_TTL_SECONDS = 5 * 60;
export const MAX_SESSION_TTL_SECONDS = 24 * 3600;

export interface SessionRequestInput {
  taskSummary: string;
  /** Decimal strings in USD. */
  maxPerTx: string;
  maxTotal: string;
  ttlSeconds: number;
}

export interface SessionPolicyContext {
  /** The business spending policy's currency and ceilings. */
  currency: string;
  maxTransactionAmount: string;
  maxTotalSpend: string;
  /** Spend already counted this period (paid orders), in the policy currency. */
  spentThisPeriod: string;
}

export type SessionRejection =
  | "SUMMARY_REQUIRED"
  | "INVALID_AMOUNT"
  | "TTL_OUT_OF_RANGE"
  | "CURRENCY_UNSUPPORTED"
  | "PER_TX_EXCEEDS_POLICY"
  | "TOTAL_EXCEEDS_REMAINING_BUDGET"
  | "PER_TX_EXCEEDS_TOTAL";

export interface SessionDecision {
  allowed: boolean;
  rejections: SessionRejection[];
  /** The most this business may request right now, for showing in the form. */
  maxPerTxAllowed: string;
  maxTotalAllowed: string;
}

/** Returns every violated rule, not just the first, so the person can fix them in one go. */
export function evaluateSessionRequest(ctx: SessionPolicyContext, input: SessionRequestInput): SessionDecision {
  const rejections: SessionRejection[] = [];

  if (ctx.currency !== PASSPORT_CURRENCY) {
    // No conversion is ever guessed. A non-USD business cannot open a Passport session yet.
    return { allowed: false, rejections: ["CURRENCY_UNSUPPORTED"], maxPerTxAllowed: "0.00", maxTotalAllowed: "0.00" };
  }

  const m = (v: string) => money(v, PASSPORT_CURRENCY);
  const positive = (v: string) => DECIMAL.test(v) && /[1-9]/.test(v);

  const remaining = subtract(m(ctx.maxTotalSpend), m(ctx.spentThisPeriod));
  const zero = m("0");
  const remainingFloor = compare(remaining, zero) < 0 ? zero : remaining;
  const perTxCap = compare(remainingFloor, m(ctx.maxTransactionAmount)) < 0 ? remainingFloor : m(ctx.maxTransactionAmount);

  if (!input.taskSummary.trim()) rejections.push("SUMMARY_REQUIRED");
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < MIN_SESSION_TTL_SECONDS || input.ttlSeconds > MAX_SESSION_TTL_SECONDS) {
    rejections.push("TTL_OUT_OF_RANGE");
  }

  if (!positive(input.maxPerTx) || !positive(input.maxTotal)) {
    rejections.push("INVALID_AMOUNT");
  } else {
    if (compare(m(input.maxPerTx), m(ctx.maxTransactionAmount)) > 0) rejections.push("PER_TX_EXCEEDS_POLICY");
    if (compare(m(input.maxTotal), remainingFloor) > 0) rejections.push("TOTAL_EXCEEDS_REMAINING_BUDGET");
    if (compare(m(input.maxPerTx), m(input.maxTotal)) > 0) rejections.push("PER_TX_EXCEEDS_TOTAL");
  }

  return { allowed: rejections.length === 0, rejections, maxPerTxAllowed: perTxCap.amount, maxTotalAllowed: remainingFloor.amount };
}

/** The delegation Passport is asked to enforce. The task text is descriptive; the caps are the limits. */
export function buildDelegation(input: SessionRequestInput) {
  return {
    task: { summary: input.taskSummary.trim().slice(0, 300) },
    payment_policy: {
      max_amount_per_tx: input.maxPerTx,
      max_total_amount: input.maxTotal,
      ttl_seconds: input.ttlSeconds,
      currency: PASSPORT_CURRENCY,
    },
  };
}

export const SESSION_REJECTION_TEXT: Record<SessionRejection, string> = {
  SUMMARY_REQUIRED: "Describe what the agent is allowed to do.",
  INVALID_AMOUNT: "Enter limits as amounts greater than zero, such as 25 or 25.50.",
  TTL_OUT_OF_RANGE: "A session must last between 5 minutes and 24 hours.",
  CURRENCY_UNSUPPORTED: "Passport sessions are in USD, and this business's spending policy is in another currency.",
  PER_TX_EXCEEDS_POLICY: "The per-payment limit is higher than your business's maximum single purchase.",
  TOTAL_EXCEEDS_REMAINING_BUDGET: "The total is more than what is left of your monthly budget.",
  PER_TX_EXCEEDS_TOTAL: "The per-payment limit cannot be more than the total.",
};
