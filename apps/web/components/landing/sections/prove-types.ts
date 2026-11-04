export type PlateState = "verified" | "unknown" | "na" | "failed";

export interface ProveProps {
  plates: { id: string; label: string; state: PlateState }[];
  verdict: "eligible" | "review_required" | "ineligible";
}
