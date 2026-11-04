import { and, desc, eq } from "drizzle-orm";
import { businessWallets, recordAudit } from "@procura/database";
import { LinkWalletSchema, ServiceError } from "@procura/shared";
import { handle, ok, readJson } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { inTenant, requireAccess } from "@/lib/guard";
import { verifyLink } from "@/lib/server/wallet";

export const runtime = "nodejs";

const dto = (w: typeof businessWallets.$inferSelect) => ({
  id: w.id, address: w.address, chainId: w.chainId, label: w.label, status: w.status,
  linkedAt: w.linkedAt.toISOString(), revokedAt: w.revokedAt?.toISOString() ?? null,
});

export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "business:read");
  const rows = await inTenant(access, (tx) =>
    tx.select().from(businessWallets).where(eq(businessWallets.businessId, access.businessId)).orderBy(desc(businessWallets.linkedAt)),
  );
  return ok(rows.map(dto));
});

/** Link a wallet by presenting the signed challenge. Needs financial authority (owner or finance manager). */
export const POST = handle(async (req: Request) => {
  const body = LinkWalletSchema.parse(await readJson(req));
  const access = await requireAccess(req, "wallet:manage");
  const proof = await verifyLink({
    message: body.message, token: body.token, signature: body.signature,
    domain: new URL(serverEnv().NEXT_PUBLIC_APP_URL).host, businessId: access.businessId, userId: access.userId,
  });

  const created = await inTenant(access, async (tx) => {
    const [existing] = await tx.select({ id: businessWallets.id }).from(businessWallets).where(and(
      eq(businessWallets.businessId, access.businessId), eq(businessWallets.address, proof.address),
      eq(businessWallets.chainId, proof.chainId), eq(businessWallets.status, "active"),
    ));
    if (existing) throw new ServiceError("WALLET_ALREADY_LINKED", "That wallet is already linked to this business.", 409);
    const [row] = await tx.insert(businessWallets).values({
      businessId: access.businessId, linkedBy: access.userId, address: proof.address, chainId: proof.chainId,
      label: body.label || null,
    }).returning();
    if (!row) throw new ServiceError("INTERNAL", "Could not link the wallet.", 500);
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "wallet.linked",
      resourceType: "business_wallet", resourceId: row.id, newState: { address: row.address, chainId: row.chainId },
    });
    return row;
  });
  return ok(dto(created), 201);
});
