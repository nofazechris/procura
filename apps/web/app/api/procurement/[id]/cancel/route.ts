import { and, eq, inArray } from "drizzle-orm";
import { procurementRequests, purchaseOrders, quotations, recordAudit } from "@procura/database";
import { assertRequestTransition, ServiceError } from "@procura/shared";
import { handle, notFound, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/**
 * Stop a procurement. Allowed while the request is still moving; refused once there is an open
 * purchase order, because cancelling around an approved or paid order would hide money.
 * Reject the order first.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "request id");
  const access = await requireAccess(req, "procurement:control");

  const result = await inTenant(access, async (tx) => {
    const [request] = await tx.select().from(procurementRequests)
      .where(and(eq(procurementRequests.id, id), eq(procurementRequests.businessId, access.businessId)));
    if (!request) return null;

    const open = await tx.select({ n: purchaseOrders.orderNumber, status: purchaseOrders.status }).from(purchaseOrders).where(and(
      eq(purchaseOrders.requestId, id),
      inArray(purchaseOrders.status, ["pending_approval", "approved", "awaiting_payment", "payment_pending", "paid", "processing"]),
    ));
    if (open.length > 0) {
      throw new ServiceError("OPEN_ORDER", `${open[0]!.n} is still ${open[0]!.status.replace("_", " ")}. Reject or resolve the order before cancelling.`, 409);
    }
    assertRequestTransition(request.status, "cancelled"); // throws InvalidTransitionError for completed/cancelled/etc.

    await tx.update(procurementRequests).set({ status: "cancelled" }).where(eq(procurementRequests.id, id));
    await tx.update(quotations).set({ quoteStatus: "received" }).where(and(eq(quotations.requestId, id), eq(quotations.quoteStatus, "selected")));
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "procurement.cancelled",
      resourceType: "procurement_request", resourceId: id, previousState: { status: request.status }, newState: { status: "cancelled", requestNumber: request.requestNumber },
    });
    return { id, status: "cancelled" as const };
  });
  if (!result) throw notFound("Procurement request");
  return ok(result);
});
