import { simulateCheckout } from "@procura/procurement";
import { handle, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/**
 * Practice checkout for an approved order. It runs the real payment gate and records a payment on
 * the "simulation" network. No Passport call is made, nothing is charged and nothing is ordered.
 * Real checkout is deliberately not available here until a funded Passport session exists.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "order id");
  const access = await requireAccess(req, "approvals:decide");
  return ok(await inTenant(access, (tx, c) => simulateCheckout(tx, c, id)));
});
