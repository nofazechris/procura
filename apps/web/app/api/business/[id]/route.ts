import { and, eq } from "drizzle-orm";
import { businesses, recordAudit } from "@procura/database";
import { UpdateBusinessSchema } from "@procura/shared";
import { forbidden, handle, notFound, ok, parseId, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "business id");
  const access = await requireAccess(req, "business:read");
  if (access.businessId !== id) throw forbidden("You are not a member of that business.");
  const [row] = await inTenant(access, (tx) => tx.select().from(businesses).where(eq(businesses.id, id)));
  if (!row) throw notFound("Business");
  return ok(row);
});

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "business id");
  const patch = UpdateBusinessSchema.parse(await readJson(req));
  const access = await requireAccess(req, "business:update");
  if (access.businessId !== id) throw forbidden("You are not a member of that business.");

  const updated = await inTenant(access, async (tx) => {
    const [before] = await tx.select().from(businesses).where(eq(businesses.id, id));
    if (!before) return null;
    const [after] = await tx.update(businesses).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
      ...(patch.website !== undefined ? { website: patch.website || null } : {}),
      ...(patch.address !== undefined ? { address: patch.address || null } : {}),
      // Preferences are merged, so a change to one never wipes the others kept from setup.
      ...(patch.preferences !== undefined ? { preferences: { ...(before.preferences ?? {}), ...patch.preferences } } : {}),
    }).where(and(eq(businesses.id, id))).returning();
    await recordAudit(tx, {
      businessId: id, actorType: "user", actorId: access.userId, action: "business.updated",
      resourceType: "business", resourceId: id,
      previousState: { name: before.name, address: before.address, preferences: before.preferences },
      newState: { name: after?.name, address: after?.address, preferences: after?.preferences },
    });
    return after;
  });
  if (!updated) throw notFound("Business");
  return ok(updated);
});
