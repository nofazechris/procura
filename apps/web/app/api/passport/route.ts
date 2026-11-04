import { desc, eq } from "drizzle-orm";
import { passportAgents, spendingSessions } from "@procura/database";
import { roleHasPermission, ServiceError } from "@procura/shared";
import { handle, ok } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { sessionDto } from "@/lib/server/passport-dto";
import { passportEnabledFor, passportStatus, type PassportStatus } from "@/lib/server/passport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the business stands with Kite Passport: the agent identity Procura registered, the sessions
 * it asked for, and (for people who manage Passport) the live state of the signed-in Passport account.
 */
export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "business:read");
  const enabled = passportEnabledFor(access.businessId);
  const canManage = roleHasPermission(access.role, "passport:manage");

  const { agent, sessions } = await inTenant(access, async (tx) => ({
    agent: (await tx.select().from(passportAgents).where(eq(passportAgents.businessId, access.businessId)).orderBy(desc(passportAgents.registeredAt)).limit(1))[0] ?? null,
    sessions: await tx.select().from(spendingSessions).where(eq(spendingSessions.businessId, access.businessId)).orderBy(desc(spendingSessions.createdAt)).limit(20),
  }));

  let live: PassportStatus | null = null;
  let liveError: { code: string; message: string } | null = null;
  // The live account check runs the kpass CLI several times, so callers must ask for it (?live=1).
  const wantsLive = new URL(req.url).searchParams.get("live") === "1";
  if (enabled && canManage && wantsLive) {
    try {
      live = await passportStatus();
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
      liveError = { code: e.code, message: e.message };
    }
  }

  return ok({
    enabled, canManage,
    agent: agent ? { type: agent.agentType, id: agent.passportAgentId, registeredAt: agent.registeredAt.toISOString() } : null,
    sessions: sessions.map(sessionDto),
    live, liveError,
    // Shown so the owner can set PASSPORT_BUSINESS_ID when Passport is not yet enabled for this business.
    businessId: enabled ? null : access.businessId,
  });
});
