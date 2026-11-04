import { and, eq } from "drizzle-orm";
import { businessWallets } from "@procura/database";
import { handle, notFound, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { readBalances } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only chain balances for one of the business's linked wallets. */
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = parseId((await params).id);
  const access = await requireAccess(req, "business:read");
  const [w] = await inTenant(access, (tx) =>
    tx.select().from(businessWallets).where(and(eq(businessWallets.id, id), eq(businessWallets.businessId, access.businessId), eq(businessWallets.status, "active"))),
  );
  if (!w) throw notFound("Wallet");
  return ok(await readBalances(w.address, w.chainId));
});
