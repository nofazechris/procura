import type { spendingSessions } from "@procura/database";

export const sessionDto = (s: typeof spendingSessions.$inferSelect) => ({
  id: s.id, taskSummary: s.taskSummary, maxPerTx: s.maxAmountPerTransaction, maxTotal: s.maxTotalAmount, asset: s.asset,
  status: s.status, createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt?.toISOString() ?? null,
  // The approval link is only useful, and only shown, while the request is waiting for a person.
  approvalUrl: s.status === "awaiting_user_approval" ? s.approvalUrl : null,
});
