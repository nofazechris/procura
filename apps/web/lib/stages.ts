import type { RequestStatus } from "@procura/shared";

/** The 11 execution stages from Design PRD s7. */
export const STAGES: { title: string; detail: string }[] = [
  { title: "Request received", detail: "The request and its line items were saved." },
  { title: "Requirements analysed", detail: "Quantities, budget and delivery needs were read from the request." },
  { title: "Supplier discovery", detail: "Searching supplier sources for matching products." },
  { title: "Quotations collected", detail: "Collecting comparable quotations from the suppliers found." },
  { title: "Supplier evaluation", detail: "Checking the evidence on file for each supplier." },
  { title: "Price comparison", detail: "Comparing full delivered cost against the requirements." },
  { title: "Recommendation generated", detail: "Ranking the eligible quotes and explaining the choice." },
  { title: "Purchase order prepared", detail: "Select a supplier to prepare the purchase order." },
  { title: "Approval required", detail: "A person must approve the order before any payment." },
  { title: "Payment execution", detail: "Payment needs an approved Kite Passport spending session." },
  { title: "Fulfilment tracking", detail: "Monitoring delivery after payment." },
];

export interface StageProgress {
  /** Stages 0..done-1 are complete. */
  done: number;
  /** The stage that is active or waiting on a person, or null when nothing is pending. */
  current: number | null;
  /** "now" is work in progress; "attn" is waiting on a person or blocked. */
  kind: "now" | "attn" | null;
  note: string;
}

/** Where a request is in the workflow, derived from its persisted status. */
export function stageProgress(status: RequestStatus): StageProgress {
  switch (status) {
    case "draft": return { done: 1, current: 1, kind: "attn", note: "Ready to source suppliers." };
    case "submitted": return { done: 1, current: 1, kind: "now", note: "Submitted." };
    case "analysing": return { done: 2, current: 2, kind: "now", note: "Analysing requirements." };
    case "sourcing": return { done: 3, current: 3, kind: "now", note: "Collecting quotations." };
    case "comparing": return { done: 7, current: 7, kind: "attn", note: "Quotes compared. Select a supplier to continue." };
    case "awaiting_approval": return { done: 8, current: 8, kind: "attn", note: "Waiting for your approval." };
    case "approved": return { done: 9, current: 9, kind: "attn", note: "Approved. Payment needs a Kite Passport session." };
    case "processing": return { done: 10, current: 10, kind: "now", note: "Paid. Tracking fulfilment." };
    case "completed": return { done: 11, current: null, kind: null, note: "Complete." };
    case "failed": return { done: 1, current: 1, kind: "attn", note: "This request failed. Review it and try again." };
    case "cancelled": return { done: 0, current: null, kind: null, note: "Cancelled." };
  }
}
