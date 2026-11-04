import { and, eq } from "drizzle-orm";
import { recordAudit, spendingSessions } from "@procura/database";
import { handle, notFound, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { approvalStatus, assertPassportEnabled } from "@/lib/server/passport";
import { sessionDto } from "@/lib/server/passport-dto";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Checks with Passport whether the person approved a session request, and records the result.
 * Only Passport's own answer can move a session to active; nothing a client sends can.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "session id");
  const access = await requireAccess(req, "passport:manage");
  assertPassportEnabled(access.businessId);

  const [row] = await inTenant(access, (tx) =>
    tx.select().from(spendingSessions).where(and(eq(spendingSessions.id, id), eq(spendingSessions.businessId, access.businessId))),
  );
  if (!row) throw notFound("Session");
  if (row.status !== "awaiting_user_approval" || !row.passportRequestId) return ok(sessionDto(row));

  const result = await approvalStatus(row.passportRequestId);
  const next = result.state === "approved" ? "active" : result.state === "rejected" ? "revoked" : result.state === "expired" ? "expired" : null;
  if (!next) return ok(sessionDto(row));

  const updated = await inTenant(access, async (tx) => {
    const [u] = await tx.update(spendingSessions).set({
      status: next,
      passportSessionReference: result.sessionId ?? row.passportSessionReference,
      expiresAt: result.expiresAt ? new Date(result.expiresAt) : row.expiresAt,
    }).where(and(eq(spendingSessions.id, id), eq(spendingSessions.businessId, access.businessId), eq(spendingSessions.status, "awaiting_user_approval"))).returning();
    if (u) {
      await recordAudit(tx, {
        businessId: access.businessId, actorType: "system", action: `passport.session_${next}`, resourceType: "spending_session",
        resourceId: id, previousState: { status: "awaiting_user_approval" }, newState: { status: next },
      });
    }
    return u ?? row;
  });
  return ok(sessionDto(updated));
});
