import { and, eq } from "drizzle-orm";
import { businessWallets, recordAudit } from "@procura/database";
import { handle, notFound, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/** Disconnect a wallet. The row is kept as history; it just stops being usable. */
export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id);
  const access = await requireAccess(req, "wallet:manage");
  const revoked = await inTenant(access, async (tx) => {
    const [row] = await tx.update(businessWallets).set({ status: "revoked", revokedAt: new Date(), revokedBy: access.userId })
      .where(and(eq(businessWallets.id, id), eq(businessWallets.businessId, access.businessId), eq(businessWallets.status, "active")))
      .returning();
    if (!row) return null;
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "wallet.revoked",
      resourceType: "business_wallet", resourceId: row.id, previousState: { status: "active" }, newState: { status: "revoked" },
    });
    return row;
  });
  if (!revoked) throw notFound("Wallet");
  return ok({ id: revoked.id, status: revoked.status });
});
