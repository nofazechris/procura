import { eq } from "drizzle-orm";
import { recordAudit, spendingPolicies } from "@procura/database";
import { compare, ServiceError, UpdatePolicySchema } from "@procura/shared";
import { handle, notFound, ok, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "business:read");
  const [policy] = await inTenant(access, (tx) =>
    tx.select().from(spendingPolicies).where(eq(spendingPolicies.businessId, access.businessId)),
  );
  if (!policy) throw notFound("Spending policy");
  return ok(policy);
});

/**
 * Change the business spending limits. Needs financial authority. These are Procura's own
 * application-level limits; Kite Passport enforces its own session limits separately, and the
 * agent has no route that can change either.
 */
export const PATCH = handle(async (req: Request) => {
  const patch = UpdatePolicySchema.parse(await readJson(req));
  const access = await requireAccess(req, "policy:manage");

  const updated = await inTenant(access, async (tx) => {
    const [before] = await tx.select().from(spendingPolicies).where(eq(spendingPolicies.businessId, access.businessId));
    if (!before) return null;
    const next = {
      maxTotalSpend: patch.maxTotalSpend ?? before.maxTotalSpend,
      maxTransactionAmount: patch.maxTransactionAmount ?? before.maxTransactionAmount,
    };
    const cur = before.currency;
    if (compare({ amount: next.maxTransactionAmount, currency: cur }, { amount: next.maxTotalSpend, currency: cur }) > 0) {
      throw new ServiceError("INVALID_LIMITS", "The maximum single purchase cannot exceed the monthly budget.", 422);
    }
    const [after] = await tx.update(spendingPolicies).set({
      ...next,
      ...(patch.approvalRequiredAbove !== undefined ? { approvalRequiredAbove: patch.approvalRequiredAbove } : {}),
      ...(patch.approvalRequired !== undefined ? { approvalRequired: patch.approvalRequired } : {}),
    }).where(eq(spendingPolicies.businessId, access.businessId)).returning();
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "policy.updated",
      resourceType: "spending_policy", resourceId: before.id,
      previousState: {
        maxTotalSpend: before.maxTotalSpend, maxTransactionAmount: before.maxTransactionAmount,
        approvalRequiredAbove: before.approvalRequiredAbove, approvalRequired: before.approvalRequired,
      },
      newState: {
        maxTotalSpend: after?.maxTotalSpend, maxTransactionAmount: after?.maxTransactionAmount,
        approvalRequiredAbove: after?.approvalRequiredAbove, approvalRequired: after?.approvalRequired,
      },
    });
    return after;
  });
  if (!updated) throw notFound("Spending policy");
  return ok(updated);
});
