import { eq } from "drizzle-orm";
import { passportAgents, recordAudit, spendingSessions } from "@procura/database";
import { loadPolicy, spentThisPeriod } from "@procura/procurement";
import { buildDelegation, evaluateSessionRequest, PASSPORT_CURRENCY, SESSION_REJECTION_TEXT } from "@procura/policies";
import { RequestPassportSessionSchema, ServiceError } from "@procura/shared";
import { handle, ok, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { assertPassportEnabled, requestSession } from "@/lib/server/passport";
import { limitPerHour } from "@/lib/server/rate-limit";
import { sessionDto } from "@/lib/server/passport-dto";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ask Kite Passport for a limited spending session. The limits are checked against this business's
 * own spending policy first, so the person who approves the passkey only ever sees limits the
 * business already allows. This creates an approval request; it spends nothing and cannot be
 * approved from here.
 */
export const POST = handle(async (req: Request) => {
  const body = RequestPassportSessionSchema.parse(await readJson(req));
  const access = await requireAccess(req, "passport:manage");
  assertPassportEnabled(access.businessId);
  limitPerHour(`passport-session:${access.userId}`, 10);

  const request = { taskSummary: body.taskSummary, maxPerTx: body.maxPerTx, maxTotal: body.maxTotal, ttlSeconds: body.ttlMinutes * 60 };

  const { decision, agent } = await inTenant(access, async (tx, c) => {
    const policy = await loadPolicy(tx, access.businessId);
    const spent = await spentThisPeriod(tx, access.businessId, policy.currency, c.now);
    const [agentRow] = await tx.select().from(passportAgents).where(eq(passportAgents.businessId, access.businessId));
    return {
      agent: agentRow ?? null,
      decision: evaluateSessionRequest(
        { currency: policy.currency, maxTransactionAmount: policy.maxTransactionAmount, maxTotalSpend: policy.maxTotalSpend, spentThisPeriod: spent }, request,
      ),
    };
  });

  if (!decision.allowed) {
    throw new ServiceError("SESSION_NOT_ALLOWED", "That session is wider than your spending policy allows.", 422, {
      rejections: decision.rejections.map((code) => ({ code, message: SESSION_REJECTION_TEXT[code] })),
      maxPerTxAllowed: decision.maxPerTxAllowed, maxTotalAllowed: decision.maxTotalAllowed,
    });
  }
  if (!agent) throw new ServiceError("AGENT_NOT_REGISTERED", "Register Procura's agent identity first.", 409);

  const approval = await requestSession(buildDelegation(request));

  const row = await inTenant(access, async (tx) => {
    const [created] = await tx.insert(spendingSessions).values({
      businessId: access.businessId, taskSummary: body.taskSummary, requestedAmount: body.maxTotal,
      maxAmountPerTransaction: body.maxPerTx, maxTotalAmount: body.maxTotal, asset: PASSPORT_CURRENCY,
      status: "awaiting_user_approval", approvalUrl: approval.approvalUrl, passportRequestId: approval.requestId,
    }).returning();
    if (!created) throw new ServiceError("INTERNAL", "Could not record the session request.", 500);
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "passport.session_requested",
      resourceType: "spending_session", resourceId: created.id,
      newState: { maxPerTx: body.maxPerTx, maxTotal: body.maxTotal, ttlMinutes: body.ttlMinutes, agentId: agent.passportAgentId, asset: PASSPORT_CURRENCY },
    });
    return created;
  });

  return ok(sessionDto(row), 201);
});
