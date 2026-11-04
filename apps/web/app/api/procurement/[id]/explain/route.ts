import { loadComparison } from "@procura/procurement";
import { recordAudit } from "@procura/database";
import { ServiceError } from "@procura/shared";
import { handle, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { explainComparison } from "@/lib/server/agent";
import { limitPerHour } from "@/lib/server/rate-limit";
import { servConfigured } from "@/lib/server/serv";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The agent explains the deterministic comparison in plain language. It is given only what the
 * engine computed and may cite only an eligible quote. The engine's recommendation stays the
 * authority; this is commentary for the person deciding.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "request id");
  const access = await requireAccess(req, "procurement:read");
  if (!servConfigured()) throw new ServiceError("SERV_NOT_CONFIGURED", "SERV Reasoning is not connected yet.", 503);
  limitPerHour(`explain:${access.userId}`, 40);

  const view = await inTenant(access, (tx, c) => loadComparison(tx, c, id));
  const result = await explainComparison(view);

  await inTenant(access, (tx) => recordAudit(tx, {
    businessId: access.businessId, actorType: "agent", actorId: access.userId, action: "agent.comparison_explained",
    resourceType: "procurement_request", resourceId: id,
    metadata: { model: result.model, usage: result.usage, agreesWithEngine: result.agreesWithEngine },
  }));

  const { model, usage: _usage, ...explanation } = result;
  return ok({ ...explanation, model });
});
