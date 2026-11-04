import { eq } from "drizzle-orm";
import { businesses, recordAudit } from "@procura/database";
import { InterpretRequestSchema, ServiceError } from "@procura/shared";
import { handle, ok, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { interpretRequest } from "@/lib/server/agent";
import { limitPerHour } from "@/lib/server/rate-limit";
import { servConfigured } from "@/lib/server/serv";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The agent reads a plain-language request and returns a DRAFT for a person to review. Nothing is
 * created here: the caller shows the draft in the normal request form, and the person confirms.
 */
export const POST = handle(async (req: Request) => {
  const { text } = InterpretRequestSchema.parse(await readJson(req));
  const access = await requireAccess(req, "procurement:create");
  if (!servConfigured()) throw new ServiceError("SERV_NOT_CONFIGURED", "SERV Reasoning is not connected yet.", 503);
  limitPerHour(`interpret:${access.userId}`, 30);

  const [biz] = await inTenant(access, (tx) =>
    tx.select({ currency: businesses.defaultCurrency }).from(businesses).where(eq(businesses.id, access.businessId)),
  );
  const result = await interpretRequest(text, { defaultCurrency: biz?.currency ?? "USD", today: new Date() });

  // Record that the agent read this text, which model did it, and what it cost. Not the text itself.
  await inTenant(access, (tx) => recordAudit(tx, {
    businessId: access.businessId, actorType: "agent", actorId: access.userId, action: "agent.request_interpreted",
    resourceType: "procurement_intent", metadata: { model: result.model, usage: result.usage, inputChars: text.length, items: result.draft.items.length },
  }));

  return ok({ draft: result.draft, missing: result.missing, notes: result.notes, model: result.model });
});
