import { desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { procurementRequests, purchaseOrders, suppliers } from "@procura/database";
import { createPurchaseOrder } from "@procura/procurement";
import { decimalString, PAYMENT_ASSET } from "@procura/shared";
import { handle, ok, readJson } from "@/lib/api";
import { conversionFor } from "@/lib/fx";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "orders:read");
  const rows = await inTenant(access, (tx) =>
    tx.select({
      ...getTableColumns(purchaseOrders),
      supplierName: suppliers.name, supplierSource: suppliers.sourceType,
      requestNumber: procurementRequests.requestNumber, requestTitle: procurementRequests.title,
    })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(procurementRequests, eq(procurementRequests.id, purchaseOrders.requestId))
      .where(eq(purchaseOrders.businessId, access.businessId))
      .orderBy(desc(purchaseOrders.createdAt)).limit(200),
  );
  return ok(rows);
});

// Deliberately no `conversion` field: the payment rate is decided on the server, not by the caller.
const Body = z.object({
  requestId: z.string().uuid(),
  quotationId: z.string().uuid(),
  /** Optional cross-check. Never used as the amount; a mismatch is rejected. */
  claimedTotal: decimalString.optional(),
  acknowledgeReview: z.boolean().optional(),
});

/** Create a purchase order from a stored quotation. The server recalculates every figure. */
export const POST = handle(async (req: Request) => {
  const access = await requireAccess(req, "orders:create");
  const input = Body.parse(await readJson(req));

  const result = await inTenant(access, (tx, c) =>
    createPurchaseOrder(tx, c, {
      requestId: input.requestId, quotationId: input.quotationId,
      ...(input.claimedTotal !== undefined ? { claimedTotal: input.claimedTotal } : {}),
      ...(input.acknowledgeReview !== undefined ? { acknowledgeReview: input.acknowledgeReview } : {}),
      resolveConversion: (currency) => conversionFor(currency, c.now),
    }),
  );
  return ok({ ...result, paymentAsset: PAYMENT_ASSET }, 201);
});
