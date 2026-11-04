import { eq } from "drizzle-orm";
import { businessMembers, user } from "@procura/database";
import { forbidden, handle, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/** Team members. Adding members needs an email provider and is not built yet. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "business id");
  const access = await requireAccess(req, "business:read");
  if (access.businessId !== id) throw forbidden("You are not a member of that business.");
  const rows = await inTenant(access, (tx) =>
    tx.select({
      id: businessMembers.id, role: businessMembers.role, status: businessMembers.status,
      userId: user.id, name: user.name, email: user.email,
    }).from(businessMembers).innerJoin(user, eq(user.id, businessMembers.userId))
      .where(eq(businessMembers.businessId, id)),
  );
  return ok(rows);
});
