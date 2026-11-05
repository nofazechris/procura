import { and, desc, eq } from "drizzle-orm";
import {
  approvals, businesses, payments, procurementRequests, purchaseOrderItems, purchaseOrders, supplierPayoutDestinations, suppliers,
} from "@procura/database";
import { handle, notFound, ok, parseId } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "order id");
  const access = await requireAccess(req, "orders:read");

  const found = await inTenant(access, async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.businessId, access.businessId)));
    if (!order) return null;
    // One connection, one transaction: run the reads in order rather than concurrently.
    const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
    const approvalRows = await tx.select().from(approvals).where(eq(approvals.purchaseOrderId, id)).orderBy(desc(approvals.createdAt));
    const [supplier] = await tx.select({
      id: suppliers.id, name: suppliers.name, sourceType: suppliers.sourceType, city: suppliers.city, countryCode: suppliers.countryCode,
    }).from(suppliers).where(eq(suppliers.id, order.supplierId));
    const [request] = await tx.select({ id: procurementRequests.id, requestNumber: procurementRequests.requestNumber, title: procurementRequests.title })
      .from(procurementRequests).where(eq(procurementRequests.id, order.requestId));
    const [business] = await tx.select({ name: businesses.name, address: businesses.address, countryCode: businesses.countryCode })
      .from(businesses).where(eq(businesses.id, access.businessId));
    const destinations = await tx.select().from(supplierPayoutDestinations).where(and(
      eq(supplierPayoutDestinations.supplierId, order.supplierId), eq(supplierPayoutDestinations.asset, order.paymentAsset),
    ));
    // The approved destination if there is one, otherwise the pending proposal.
    const destination = destinations.find((d) => d.status === "approved") ?? destinations.find((d) => d.status === "pending") ?? null;
    const paymentRows = await tx.select({
      id: payments.id, status: payments.status, network: payments.network, amount: payments.amount, asset: payments.asset,
      reference: payments.transactionHash, confirmedAt: payments.confirmedAt,
    }).from(payments).where(eq(payments.purchaseOrderId, id)).orderBy(desc(payments.createdAt));
    return {
      order, items, approvals: approvalRows, payments: paymentRows, supplier: supplier ?? null, request: request ?? null,
      business: business ?? null, destination,
    };
  });
  if (!found) throw notFound("Purchase order");
  return ok(found);
});
