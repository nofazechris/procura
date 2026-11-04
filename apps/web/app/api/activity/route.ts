import { desc, eq } from "drizzle-orm";
import { auditLogs, user } from "@procura/database";
import { handle, ok } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/** The audit trail, newest first. Backed by the append-only audit_logs table, so it reflects what actually happened. */
export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "business:read");
  const rows = await inTenant(access, (tx) =>
    tx.select({
      id: auditLogs.id, actorType: auditLogs.actorType, actorId: auditLogs.actorId, actorName: user.name,
      action: auditLogs.action, resourceType: auditLogs.resourceType, resourceId: auditLogs.resourceId,
      newState: auditLogs.newState, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt,
    })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorId))
      .where(eq(auditLogs.businessId, access.businessId))
      .orderBy(desc(auditLogs.createdAt)).limit(150),
  );
  return ok(rows);
});
