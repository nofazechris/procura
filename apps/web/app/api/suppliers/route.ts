import { desc, eq } from "drizzle-orm";
import { supplierEvidence, suppliers } from "@procura/database";
import { summariseEvidence } from "@procura/procurement";
import { handle, ok } from "@/lib/api";
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
