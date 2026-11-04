import type { SupplierDTO } from "@/lib/dto";
import { Pill } from "./ui";

/** Fully verified means identity, contact and payment destination all passed. Unknown is never counted as passed. */
export function supplierState(s: Pick<SupplierDTO, "evidenceSummary">): "verified" | "review" | "partial" | "unverified" {
  const e = s.evidenceSummary;
  if (e.identityVerified === false || e.contactVerified === false || e.paymentDestinationMatched === false) return "review";
  if (e.identityVerified && e.contactVerified && e.paymentDestinationMatched) return "verified";
  if (e.identityVerified || e.contactVerified || e.paymentDestinationMatched) return "partial";
  return "unverified";
}

export function SupplierStatePill({ state }: { state: ReturnType<typeof supplierState> }) {
  return state === "verified" ? <Pill tone="ok">Evidence verified</Pill>
    : state === "review" ? <Pill tone="warn">Review required</Pill>
    : state === "partial" ? <Pill tone="info">Partial evidence</Pill>
    : <Pill tone="mute">Unverified</Pill>;
}
