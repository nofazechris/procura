import type { ExecutionRejection } from "@procura/policies/core";

/** Plain-words explanations of the engine's codes, for the landing page's interactive sections. */

export const REASON_TEXT: Record<string, string> = {
  OVER_BUDGET: "over budget",
  MISSING_ITEMS: "an item is not quoted",
  INSUFFICIENT_QUANTITY: "not enough stock quoted",
  LATE_DELIVERY: "too slow",
  UNAVAILABLE: "unavailable",
  QUOTE_EXPIRED: "quote expired",
  IDENTITY_NOT_VERIFIED: "identity not verified",
  IDENTITY_FAILED: "identity check failed",
  CONTACT_NOT_VERIFIED: "contact not verified",
  PAYMENT_DESTINATION_NOT_VERIFIED: "payout address not verified",
  PAYMENT_DESTINATION_MISMATCH: "payout address does not match",
  SUPPLIER_RESTRICTED: "supplier restricted",
  PARTIAL_AVAILABILITY: "partial availability",
  AVAILABILITY_UNKNOWN: "availability unknown",
  DELIVERY_UNKNOWN: "delivery unknown",
};
export const reasonText = (c: string) => REASON_TEXT[c] ?? c.toLowerCase().replace(/_/g, " ");

export const REJECTION_TEXT: Record<ExecutionRejection, string> = {
  POLICY_NOT_ALLOWED: "The spending policy does not allow this order.",
  SUPPLIER_RESTRICTED: "This supplier is on the restricted list.",
  SESSION_MISSING: "There is no authorised session.",
  SESSION_NOT_ACTIVE: "The session is not active.",
  SESSION_EXPIRED: "The session has expired.",
  SESSION_ASSET_MISMATCH: "The session covers a different asset.",
  SESSION_BUDGET_INSUFFICIENT: "The payment is more than the session has left.",
  SESSION_TX_LIMIT_EXCEEDED: "The payment is over the per-payment limit.",
  RECIPIENT_NOT_APPROVED: "No payee was approved by a person.",
  RECIPIENT_MISMATCH: "The payee is not the one a person approved.",
  ORDER_CHANGED_AFTER_APPROVAL: "The order no longer matches what was approved.",
  DUPLICATE_PAYMENT: "This order has already been paid.",
  UNSUPPORTED_ASSET: "That asset is not supported.",
  USER_APPROVAL_MISSING: "No person approved this payment.",
};

/** SHA-256 of text, in the browser: the same digest the server computes for an order fingerprint. */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const usd = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
