import { compare, toUnits } from "@procura/shared";
import type {
  Eligibility, EligibilityReason, Quote, Requirement, SupplierContext,
} from "./types";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Deterministic eligibility filter (Technical PRD s10.2). Runs BEFORE any model ranks candidates,
 * so a model can only ever choose among quotes this function allowed.
 *
 * Hard failures make a quote `ineligible`. Missing or unknown information makes it
 * `review_required`, because unknown is never treated as success. Soft concerns are reported but
 * do not block.
 */
export function evaluateEligibility(
  quote: Quote,
  requirement: Requirement,
  supplier: SupplierContext,
  now: Date,
): Eligibility {
  const hard: EligibilityReason[] = [];
  const review: EligibilityReason[] = [];
  const concerns: string[] = [];
  const missingEvidence: string[] = [];

  if (quote.currency !== requirement.currency) {
    // Never compare across currencies without an explicit conversion.
    hard.push("CURRENCY_MISMATCH");
  }

  if (quote.status === "rejected" || quote.status === "expired") hard.push("QUOTE_NOT_ACTIVE");
  if (quote.validUntil && quote.validUntil.getTime() <= now.getTime()) hard.push("QUOTE_EXPIRED");

  if (quote.availability === "unavailable") hard.push("UNAVAILABLE");
  else if (quote.availability === "partial") review.push("PARTIAL_AVAILABILITY");
  else if (quote.availability === "unknown") review.push("AVAILABILITY_UNKNOWN");

  // Every requested item must be priced, in sufficient quantity.
  for (const item of requirement.items) {
    const line = quote.lines.find((l) => norm(l.description) === norm(item.name));
    if (!line) {
      if (!hard.includes("MISSING_ITEMS")) hard.push("MISSING_ITEMS");
      concerns.push(`Not quoted: ${item.name}`);
    } else if (toUnits(line.quantity) < toUnits(item.quantity)) {
      if (!hard.includes("INSUFFICIENT_QUANTITY")) hard.push("INSUFFICIENT_QUANTITY");
      concerns.push(`${item.name}: quoted ${line.quantity}, needed ${item.quantity}`);
    }
  }

  // Budget is compared only when the currencies agree.
  if (quote.currency === requirement.currency) {
    const total = { amount: quote.totalCost, currency: quote.currency };
    if (compare(total, { amount: requirement.budget, currency: requirement.currency }) > 0) hard.push("OVER_BUDGET");
  }

  if (requirement.maxDeliveryDays !== null) {
    if (quote.estimatedDeliveryDays === null) review.push("DELIVERY_UNKNOWN");
    else if (quote.estimatedDeliveryDays > requirement.maxDeliveryDays) hard.push("LATE_DELIVERY");
  }

  if (quote.unknownCosts.length > 0) {
    concerns.push(`Costs not stated by supplier: ${quote.unknownCosts.join(", ")}. The total may be understated.`);
  }

  if (supplier.restricted) hard.push("SUPPLIER_RESTRICTED");

  const ev = supplier.evidence;
  if (ev.identityVerified === false) hard.push("IDENTITY_FAILED");
  else if (ev.identityVerified === null) { review.push("IDENTITY_NOT_VERIFIED"); missingEvidence.push("business_identity"); }

  if (ev.contactVerified !== true) { review.push("CONTACT_NOT_VERIFIED"); missingEvidence.push("contact_information"); }

  if (ev.paymentDestinationMatched === false) hard.push("PAYMENT_DESTINATION_MISMATCH");
  else if (ev.paymentDestinationMatched === null) { review.push("PAYMENT_DESTINATION_NOT_VERIFIED"); missingEvidence.push("payment_destination"); }

  if (!ev.historicalPerformanceAvailable) {
    // A concern, not a blocker: a new supplier can still be a sound choice.
    missingEvidence.push("delivery_history");
    concerns.push("No delivery history on record");
  }

  const verdict = hard.length > 0 ? "ineligible" : review.length > 0 ? "review_required" : "eligible";
  return {
    quoteId: quote.id,
    supplierId: quote.supplierId,
    verdict,
    reasons: [...hard, ...review],
    concerns: [...new Set([...concerns, ...ev.unresolvedConcerns.filter((c) => !c.startsWith("No delivery history"))])],
    missingEvidence: [...new Set(missingEvidence)],
  };
}
