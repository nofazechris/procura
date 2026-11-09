import { and, desc, eq } from "drizzle-orm";
import { payments } from "@procura/database";
import { handle, notFound, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { assertPassportEnabled } from "@/lib/server/passport";
import { orderStatus } from "@/lib/server/passport-shop";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Asks Kite Passport where a real order stands: placed, being placed, failed or refunded. Reads only. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "order id");
  const access = await requireAccess(req, "payments:read");
  assertPassportEnabled(access.businessId);
  const [pay] = await inTenant(access, (tx) =>
    tx.select().from(payments).where(and(eq(payments.purchaseOrderId, id), eq(payments.businessId, access.businessId))).orderBy(desc(payments.createdAt)).limit(1));
  if (!pay) throw notFound("Payment");
  const ref = pay.providerReference;
  if (!ref || ref === "amazon-checkout" || pay.network === "simulation") return ok({ known: false, paymentStatus: pay.status });
  return ok({ known: true, paymentStatus: pay.status, order: await orderStatus(ref) });
});
