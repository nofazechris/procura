import { desc, eq, inArray } from "drizzle-orm";
import {
  approvals, procurementRequests, purchaseOrders, supplierPayoutDestinations, suppliers,
} from "@procura/database";
import { handle, ok } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/** Approvals with the context a reviewer needs: what is being bought, from whom, for how much, and who gets paid. */
export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "approvals:read");
  const data = await inTenant(access, async (tx) => {
    const rows = await tx
      .select({
        id: approvals.id, status: approvals.status, amount: approvals.amount, currency: approvals.currency,
        reason: approvals.reason, expiresAt: approvals.expiresAt, decidedAt: approvals.decidedAt, createdAt: approvals.createdAt,
        orderId: purchaseOrders.id, orderNumber: purchaseOrders.orderNumber, orderStatus: purchaseOrders.status,
        paymentAsset: purchaseOrders.paymentAsset, paymentAmount: purchaseOrders.paymentAmount,
        requestId: procurementRequests.id, requestNumber: procurementRequests.requestNumber, requestTitle: procurementRequests.title,
        supplierId: suppliers.id, supplierName: suppliers.name, supplierSource: suppliers.sourceType,
      })
      .from(approvals)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, approvals.purchaseOrderId))
      .innerJoin(procurementRequests, eq(procurementRequests.id, purchaseOrders.requestId))
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(approvals.businessId, access.businessId))
      .orderBy(desc(approvals.createdAt))
      .limit(200);

    const supplierIds = [...new Set(rows.map((r) => r.supplierId))];
    const dests = supplierIds.length
      ? await tx.select().from(supplierPayoutDestinations).where(inArray(supplierPayoutDestinations.supplierId, supplierIds))
      : [];
    return rows.map((r) => {
      const mine = dests.filter((d) => d.supplierId === r.supplierId && d.asset === r.paymentAsset);
      const destination = mine.find((d) => d.status === "approved") ?? mine.find((d) => d.status === "pending") ?? null;
      return { ...r, destination };
    });
  });
  return ok(data);
});
