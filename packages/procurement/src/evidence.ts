import type { EvidenceType, SupplierEvidenceSummary, VerificationStatus } from "@procura/shared";

export interface EvidenceRow {
  evidenceType: EvidenceType;
  verificationStatus: VerificationStatus;
  expiresAt: Date | null;
}

/**
 * Collapse a supplier's evidence rows into a summary (Technical PRD s9.4).
 *
 * Rules that matter:
 *  - no row for a check  -> null (unknown), never true
 *  - status "verified"   -> true;  "failed" -> false;  "unknown"/"unverified" -> null
 *  - expired evidence is ignored, so it reads as unknown rather than stale success
 *  - if rows of the same type disagree, a failure wins over a success
 */
export function summariseEvidence(rows: EvidenceRow[], now: Date): SupplierEvidenceSummary {
  const live = rows.filter((r) => !r.expiresAt || r.expiresAt.getTime() > now.getTime());

  const tri = (type: EvidenceType): boolean | null => {
    const mine = live.filter((r) => r.evidenceType === type);
    if (mine.some((r) => r.verificationStatus === "failed")) return false;
    if (mine.some((r) => r.verificationStatus === "verified")) return true;
    return null;
  };

  const identityVerified = tri("business_identity");
  const contactVerified = tri("contact_information");
  const paymentDestinationMatched = tri("payment_destination");
  const quotationReceived = live.some((r) => r.evidenceType === "quotation" && r.verificationStatus !== "failed");
  const historicalPerformanceAvailable = live.some(
    (r) => (r.evidenceType === "delivery_history" || r.evidenceType === "transaction_history") && r.verificationStatus === "verified",
  );

  const unresolvedConcerns: string[] = [];
  if (identityVerified === false) unresolvedConcerns.push("Business identity check failed");
  if (contactVerified === false) unresolvedConcerns.push("Contact information check failed");
  if (paymentDestinationMatched === false) unresolvedConcerns.push("Payment destination did not match the business");
  if (!historicalPerformanceAvailable) unresolvedConcerns.push("No delivery history on record");

  return {
    identityVerified, contactVerified, quotationReceived, paymentDestinationMatched,
    historicalPerformanceAvailable, unresolvedConcerns,
  };
}

/** How much verified evidence a supplier has, used only as a tie-breaker when reliability is the priority. */
export function evidenceScore(e: SupplierEvidenceSummary): number {
  return [e.identityVerified, e.contactVerified, e.paymentDestinationMatched].filter((v) => v === true).length
    + (e.historicalPerformanceAvailable ? 1 : 0)
    + (e.quotationReceived ? 1 : 0);
}
