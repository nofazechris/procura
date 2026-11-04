import { and, desc, eq } from "drizzle-orm";
import { spendingSessions } from "@procura/database";
import { estimateCost, plannedChecks, VERIFY_CHECKS, VERIFY_CHECK_IDS } from "@procura/procurement";
import { VerifySupplierSchema } from "@procura/shared";
import { handle, notFound, ok, parseId, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { assertPassportEnabled, passportEnabledFor } from "@/lib/server/passport";
import { limitPerHour } from "@/lib/server/rate-limit";
import { factsOf, loadVerifiable, runVerification } from "@/lib/server/verify";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * What a verification would do and cost, before anything is bought: the checks, their prices, which
 * ones are missing information, and which approved sessions could pay for them. Reads only.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "supplier id");
  const access = await requireAccess(req, "suppliers:read");
  const found = await inTenant(access, async (tx, c) => {
    const supplier = await loadVerifiable(tx, access, id);
    if (!supplier) return null;
    const sessions = await tx.select().from(spendingSessions)
      .where(and(eq(spendingSessions.businessId, access.businessId), eq(spendingSessions.status, "active"))).orderBy(desc(spendingSessions.createdAt)).limit(20);
    return { supplier, sessions: sessions.filter((s) => s.passportSessionReference && (!s.expiresAt || s.expiresAt > c.now)) };
  });
  if (!found) throw notFound("Supplier");

  const plan = plannedChecks(factsOf(found.supplier), VERIFY_CHECK_IDS);
  return ok({
    enabled: passportEnabledFor(access.businessId),
    checks: plan.map((p) => ({ id: p.id, label: VERIFY_CHECKS[p.id].label, proves: VERIFY_CHECKS[p.id].proves, limit: VERIFY_CHECKS[p.id].limit, price: p.price, ready: p.ready, missing: p.missing })),
    estimate: estimateCost(plan),
    currency: "USD",
    sessions: found.sessions.map((s) => ({ id: s.id, taskSummary: s.taskSummary, maxPerTx: s.maxAmountPerTransaction, maxTotal: s.maxTotalAmount, expiresAt: s.expiresAt?.toISOString() ?? null })),
  });
});

/**
 * Runs the chosen checks, paying for each from one approved spending session. Needs the permission to
 * manage Passport, because it spends. The person's own confirmed total must cover the price, and
 * Passport still enforces the session's limits on top.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "supplier id");
  const body = VerifySupplierSchema.parse(await readJson(req));
  const access = await requireAccess(req, "passport:manage");
  assertPassportEnabled(access.businessId);
  limitPerHour(`verify:${access.userId}`, 20);
  return ok(await runVerification(access, id, body));
});
