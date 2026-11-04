import { and, desc, eq } from "drizzle-orm";
import { quotations, supplierEvidence, supplierPayoutDestinations, suppliers } from "@procura/database";
import { summariseEvidence } from "@procura/procurement";
import { handle, notFound, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "supplier id");
  const access = await requireAccess(req, "suppliers:read");

  const found = await inTenant(access, async (tx, c) => {
    const [supplier] = await tx.select().from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.businessId, access.businessId)));
    if (!supplier) return null;
    const evidence = await tx.select().from(supplierEvidence).where(eq(supplierEvidence.supplierId, id));
    const destinations = await tx.select().from(supplierPayoutDestinations).where(eq(supplierPayoutDestinations.supplierId, id));
    const quotes = await tx.select().from(quotations).where(eq(quotations.supplierId, id)).orderBy(desc(quotations.createdAt)).limit(50);
    return {
      supplier, evidence, payoutDestinations: destinations, quotations: quotes,
      evidenceSummary: summariseEvidence(
        evidence.map((e) => ({ evidenceType: e.evidenceType, verificationStatus: e.verificationStatus, expiresAt: e.expiresAt })), c.now,
      ),
    };
  });
  if (!found) throw notFound("Supplier");
  return ok(found);
});
