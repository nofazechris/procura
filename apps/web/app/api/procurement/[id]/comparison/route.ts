import { loadComparison } from "@procura/procurement";
import { handle, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/** Deterministic comparison of the stored quotations for a request. No model is involved. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "request id");
  const access = await requireAccess(req, "procurement:read");
  return ok(await inTenant(access, (tx, c) => loadComparison(tx, c, id)));
});
