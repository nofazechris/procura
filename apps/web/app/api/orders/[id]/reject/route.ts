import { z } from "zod";
import { rejectOrder } from "@procura/procurement";
import { handle, ok, parseId, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

const Body = z.object({ reason: z.string().max(500).optional() });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "order id");
  const { reason } = Body.parse(await readJson(req).catch(() => ({})));
  const access = await requireAccess(req, "approvals:decide");
  await inTenant(access, (tx, c) => rejectOrder(tx, c, id, reason));
  return ok({ id, status: "cancelled" });
});
