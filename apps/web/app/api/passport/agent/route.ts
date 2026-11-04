import { eq } from "drizzle-orm";
import { passportAgents, recordAudit } from "@procura/database";
import { handle, ok } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { assertPassportEnabled, registerAgent } from "@/lib/server/passport";

export const runtime = "nodejs";
export const maxDuration = 60;

const AGENT_TYPE = "procura-agent";

/**
 * Registers Procura's agent identity at Kite Passport under the owner's account, and records the
 * identity Passport issued. Registering again returns the same identity, so this is safe to repeat.
 */
export const POST = handle(async (req: Request) => {
  const access = await requireAccess(req, "passport:manage");
  assertPassportEnabled(access.businessId);

  const agent = await registerAgent(AGENT_TYPE);
  const row = await inTenant(access, async (tx) => {
    const [existing] = await tx.select().from(passportAgents).where(eq(passportAgents.businessId, access.businessId));
    if (existing && existing.passportAgentId === agent.agentId) return existing;
    const [created] = await tx.insert(passportAgents).values({
      businessId: access.businessId, agentType: agent.type, passportAgentId: agent.agentId, passportOwnerId: agent.ownerId, registeredBy: access.userId,
    }).onConflictDoNothing().returning();
    if (created) {
      await recordAudit(tx, {
        businessId: access.businessId, actorType: "user", actorId: access.userId, action: "passport.agent_registered",
        resourceType: "passport_agent", resourceId: created.id, newState: { agentId: agent.agentId, type: agent.type },
      });
    }
    return created ?? existing!;
  });
  return ok({ type: row.agentType, id: row.passportAgentId, registeredAt: row.registeredAt.toISOString() }, 201);
});
