import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  businessMembers, businesses, recordAudit, slugify, spendingPolicies, withTenant,
} from "@procura/database";
import { CreateBusinessSchema, compare } from "@procura/shared";
import { badRequest, handle, ok, readJson } from "@/lib/api";
import { requireUser } from "@/lib/guard";

export const runtime = "nodejs";

/** The businesses the signed-in user belongs to. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  const rows = await withTenant({ userId: user.userId }, (tx) =>
    tx
      .select({
        id: businesses.id, name: businesses.name, slug: businesses.slug,
        defaultCurrency: businesses.defaultCurrency, role: businessMembers.role,
      })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(eq(businessMembers.userId, user.userId)),
  );
  return ok(rows);
});

/**
 * Onboarding: create the business, the owner membership and the starting spending policy in one
 * transaction (Technical PRD s6.1). The id is generated here so the row-level-security context
 * can be set to it before the first insert.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  const input = CreateBusinessSchema.parse(await readJson(req));

  const currency = input.defaultCurrency;
  if (compare({ amount: input.maxSinglePurchase, currency }, { amount: input.monthlyBudget, currency }) > 0) {
    throw badRequest("INVALID_LIMITS", "The maximum single purchase cannot exceed the monthly budget.");
  }

  const businessId = randomUUID();
  const slug = `${slugify(input.name)}-${businessId.slice(0, 6)}`;

  const created = await withTenant({ userId: user.userId, businessId }, async (tx) => {
    const [business] = await tx
      .insert(businesses)
      .values({
        id: businessId, name: input.name, slug, industry: input.industry,
        countryCode: input.countryCode, defaultCurrency: currency,
        website: input.website || null, address: input.address ?? null,
        preferences: input.preferences ?? {},
      })
      .returning();
    await tx.insert(businessMembers).values({ businessId, userId: user.userId, role: "owner", status: "active" });
    await tx.insert(spendingPolicies).values({
      businessId, currency,
      maxTotalSpend: input.monthlyBudget,
      maxTransactionAmount: input.maxSinglePurchase,
      approvalRequired: true,
      approvalRequiredAbove: input.approvalRequiredAbove ?? null,
    });
    await recordAudit(tx, {
      businessId, actorType: "user", actorId: user.userId, action: "business.created",
      resourceType: "business", resourceId: businessId,
      newState: { name: input.name, currency, monthlyBudget: input.monthlyBudget, maxSinglePurchase: input.maxSinglePurchase },
    });
    return business;
  });

  return ok(created, 201);
});
