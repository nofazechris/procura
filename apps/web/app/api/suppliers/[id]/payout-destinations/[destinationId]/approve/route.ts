import { approvePayoutDestination } from "@procura/procurement";
import { handle, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/**
 * A person approves where Procura may send a supplier's money. Requires financial authority.
 * The agent can propose an address but has no route that approves one.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string; destinationId: string }> }) => {
  const p = await ctx.params;
  parseId(p.id, "supplier id");
  const destinationId = parseId(p.destinationId, "destination id");
  const access = await requireAccess(req, "approvals:decide");
  return ok(await inTenant(access, (tx, c) => approvePayoutDestination(tx, c, destinationId)));
});
