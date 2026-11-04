import { desc, eq } from "drizzle-orm";
import { payments, purchaseOrders, suppliers } from "@procura/database";
import { handle, ok } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

/**
 * Payments as recorded. Status reflects the provider or chain response; nothing here is marked
 * confirmed because an agent initiated it. Execution arrives with the Kite Passport phase.
 */
export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "payments:read");
  const rows = await inTenant(access, (tx) =>
    tx.select({
      id: payments.id, status: payments.status, amount: payments.amount, asset: payments.asset, network: payments.network,
      recipientAddress: payments.recipientAddress, transactionHash: payments.transactionHash,
      failureReason: payments.failureReason, confirmedAt: payments.confirmedAt, createdAt: payments.createdAt,
      orderId: purchaseOrders.id, orderNumber: purchaseOrders.orderNumber,
      supplierId: suppliers.id, supplierName: suppliers.name,
    })
      .from(payments)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, payments.purchaseOrderId))
      .innerJoin(suppliers, eq(suppliers.id, payments.supplierId))
      .where(eq(payments.businessId, access.businessId))
      .orderBy(desc(payments.createdAt)).limit(200),
  );
  return ok(rows);
});
