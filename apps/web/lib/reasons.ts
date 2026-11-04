/** Plain-language text for the codes the policy and eligibility engines return. */

const REASONS: Record<string, string> = {
  CURRENCY_MISMATCH: "Quoted in a different currency from the request.",
  QUOTE_NOT_ACTIVE: "This quotation is no longer active.",
  QUOTE_EXPIRED: "This quotation has expired.",
  UNAVAILABLE: "The supplier cannot supply these items.",
  PARTIAL_AVAILABILITY: "Only some of the requested items are available.",
  AVAILABILITY_UNKNOWN: "The supplier has not confirmed availability.",
  MISSING_ITEMS: "Not every requested item is priced.",
  INSUFFICIENT_QUANTITY: "The supplier quoted less than the quantity needed.",
  OVER_BUDGET: "The delivered total is over the request budget.",
  LATE_DELIVERY: "Delivery would arrive after the deadline.",
  DELIVERY_UNKNOWN: "Delivery time is not stated.",
  SUPPLIER_RESTRICTED: "This supplier is restricted by your policy.",
  IDENTITY_NOT_VERIFIED: "Business identity is not verified.",
  IDENTITY_FAILED: "The business identity check failed.",
  CONTACT_NOT_VERIFIED: "Contact details are not verified.",
  PAYMENT_DESTINATION_NOT_VERIFIED: "The payment destination is not verified.",
  PAYMENT_DESTINATION_MISMATCH: "The payment destination does not match the business.",
  // policy
  EXCEEDS_BUSINESS_BUDGET: "This would exceed your monthly spending limit.",
  EXCEEDS_TRANSACTION_LIMIT: "This is above your per-purchase limit.",
  SUPPLIER_NOT_APPROVED: "This supplier is not on your approved list.",
  CATEGORY_RESTRICTED: "A category in this order is restricted.",
  CATEGORY_NOT_ALLOWED: "A category in this order is outside your allowed list.",
};

export const reasonText = (code: string): string => REASONS[code] ?? code.replace(/_/g, " ").toLowerCase();

/** The evidence checks shown on a supplier card, in order. */
export const EVIDENCE_CHECKS = [
  { key: "identityVerified", ok: "Identity verified", unknown: "Identity not verified", failed: "Identity check failed" },
  { key: "contactVerified", ok: "Contact verified", unknown: "Contact not verified", failed: "Contact check failed" },
  { key: "quotationReceived", ok: "Quote received", unknown: "No quote on file", failed: "Quote rejected" },
  { key: "paymentDestinationMatched", ok: "Payment address matched", unknown: "Payment address not verified", failed: "Payment address mismatch" },
  { key: "historicalPerformanceAvailable", ok: "Delivery history on record", unknown: "No delivery history", failed: "No delivery history" },
] as const;
