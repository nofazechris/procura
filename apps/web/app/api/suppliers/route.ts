import { desc, eq } from "drizzle-orm";
import { recordAudit, supplierEvidence, suppliers } from "@procura/database";
import { summariseEvidence } from "@procura/procurement";
import { CreateSupplierSchema, ServiceError } from "@procura/shared";
import { handle, ok, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "suppliers:read");
  const data = await inTenant(access, async (tx, c) => {
    const rows = await tx.select().from(suppliers).where(eq(suppliers.businessId, access.businessId))
      .orderBy(desc(suppliers.createdAt)).limit(200);
    const evidence = await tx.select().from(supplierEvidence).where(eq(supplierEvidence.businessId, access.businessId));
    return rows.map((s) => ({
      ...s,
      // Unknown stays unknown: a supplier with no evidence rows has null checks, not passed ones.
      evidenceSummary: summariseEvidence(
        evidence.filter((e) => e.supplierId === s.id)
          .map((e) => ({ evidenceType: e.evidenceType, verificationStatus: e.verificationStatus, expiresAt: e.expiresAt })),
        c.now,
      ),
    }));
  });
  // sourceType lets the UI label fictional demo suppliers as demo data.
  return ok(data);
});

/**
 * Add a supplier by hand. Everything the person types is "supplier provided": it counts as verified
 * only after an evidence check says so, never because it was entered.
 */
export const POST = handle(async (req: Request) => {
  const body = CreateSupplierSchema.parse(await readJson(req));
  const access = await requireAccess(req, "suppliers:write");
  return ok(
    await inTenant(access, async (tx) => {
      const [created] = await tx.insert(suppliers).values({
        businessId: access.businessId, name: body.name, legalName: body.legalName ?? null, website: body.website ?? null,
        countryCode: body.countryCode ?? null, city: body.city ?? null, email: body.email ?? null, phone: body.phone ?? null,
        categories: body.categories, sourceType: "manual", verificationStatus: "unknown",
      }).returning();
      if (!created) throw new ServiceError("INTERNAL", "Could not add the supplier.", 500);
      await recordAudit(tx, {
        businessId: access.businessId, actorType: "user", actorId: access.userId, action: "supplier.created",
        resourceType: "supplier", resourceId: created.id, newState: { name: created.name, sourceType: "manual" },
      });
      return created;
    }),
    201,
  );
});
