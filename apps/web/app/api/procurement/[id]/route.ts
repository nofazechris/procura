import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { procurementItems, procurementRequests, withTenant } from "@procura/database";
import { badRequest, handle, notFound, ok } from "@/lib/api";
import { requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw badRequest("INVALID_ID", "Invalid request id.");

  const access = await requireAccess(req, "procurement:read");
  const found = await withTenant({ userId: access.userId, businessId: access.businessId }, async (tx) => {
    const [request] = await tx
      .select()
      .from(procurementRequests)
      .where(and(eq(procurementRequests.id, id), eq(procurementRequests.businessId, access.businessId)));
    if (!request) return null;
    const items = await tx.select().from(procurementItems).where(eq(procurementItems.requestId, id));
    return { ...request, items };
  });

  // Same response for "does not exist" and "belongs to another business": no information leak.
  if (!found) throw notFound("Procurement request");
  return ok(found);
});
