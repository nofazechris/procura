import { approveOrder } from "@procura/procurement";
import { handle, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/**
 * Approve a purchase order. Needs financial authority (owner, admin or finance manager).
 * Approving records what was approved; it does not move money. Payment needs a Passport session.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "order id");
  const access = await requireAccess(req, "approvals:decide");
  return ok(await inTenant(access, (tx, c) => approveOrder(tx, c, id)));
});
