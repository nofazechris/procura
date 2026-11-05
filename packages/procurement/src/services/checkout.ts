import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { payments, procurementItems, purchaseOrders, recordAudit, suppliers, type DbLike } from "@procura/database";
import {
  amazonCheckoutLimits, evaluateOrderPolicy, evaluatePaymentExecution, exceedsCap, MARKETPLACE_RECIPIENT, settleCheckout,
  type CheckoutLimits, type CheckoutSettlement, type ExecutionRejection,
} from "@procura/policies";
import { money, ServiceError } from "@procura/shared";
import type { ServiceContext } from "./context";
import { approvedDestination, fingerprintFor, loadPolicy, spentThisPeriod } from "./orders";

/** The network recorded on a practice checkout. Anything with this network moved no money. */
export const SIMULATION_NETWORK = "simulation";

export const REJECTION_MESSAGE: Record<ExecutionRejection, string> = {
  POLICY_NOT_ALLOWED: "Your spending limits no longer allow this order.",
  SUPPLIER_RESTRICTED: "This seller is restricted.",
  SESSION_MISSING: "There is no spending session.",
  SESSION_NOT_ACTIVE: "The spending session is not active.",
  SESSION_EXPIRED: "The spending session has expired.",
  SESSION_ASSET_MISMATCH: "The session is in a different currency.",
  SESSION_BUDGET_INSUFFICIENT: "The session does not have enough left for this order.",
  SESSION_TX_LIMIT_EXCEEDED: "The order is above the session's per-payment limit.",
  RECIPIENT_NOT_APPROVED: "Nobody has approved who this would be paid to.",
  RECIPIENT_MISMATCH: "The payee is not the one you approved.",
  ORDER_CHANGED_AFTER_APPROVAL: "The order changed after you approved it, so the approval no longer covers it.",
  DUPLICATE_PAYMENT: "This order has already been paid.",
  UNSUPPORTED_ASSET: "This currency is not supported.",
  USER_APPROVAL_MISSING: "Nobody approved this order.",
};

export interface CheckoutReceipt {
  paymentId: string;
  reference: string;
  simulated: true;
  recipient: string;
  limits: CheckoutLimits | null;
  settlement: CheckoutSettlement | null;
  /** True when the order was paid at a marketplace checkout rather than to a supplier address. */
  marketplace: boolean;
}

/**
 * A practice checkout. It runs the real payment gate against the order exactly as approved (the
 * same fingerprint check, approval check, duplicate check and policy check a live payment would
 * face), then records a payment on the "simulation" network. Nothing is charged and nothing is
 * ordered: there is no Passport call here at all. It exists so the whole flow can be walked end to
 * end before a wallet holds funds.
 *
 * The order stays "approved" and is not counted as spend, so a practice run never uses up a budget.
 */
export async function simulateCheckout(tx: DbLike, ctx: ServiceContext, orderId: string): Promise<CheckoutReceipt> {
  const [order] = await tx.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.businessId, ctx.businessId)));
  if (!order) throw new ServiceError("NOT_FOUND", "Order not found.", 404);
  if (order.status !== "approved") {
    throw new ServiceError("INVALID_STATE", `Only an approved order can be checked out, not one that is "${order.status}".`, 409);
  }
  if (order.currency !== "USD") {
    throw new ServiceError("CHECKOUT_USD_ONLY", "Checkout is priced in USD for now.", 422);
  }
  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
  if (!supplier) throw new ServiceError("NOT_FOUND", "Seller not found.", 404);
  const marketplace = supplier.sourceType === "marketplace";

  let recipient = MARKETPLACE_RECIPIENT;
  if (!marketplace) {
    const dest = await approvedDestination(tx, order.supplierId, order.paymentAsset);
    if (!dest) throw new ServiceError("RECIPIENT_NOT_APPROVED", "Approve the seller's payment address first.", 409);
    recipient = dest.address;
  }

  const live = await tx.select({ id: payments.id }).from(payments).where(and(
    eq(payments.purchaseOrderId, orderId),
    inArray(payments.status, ["prepared", "awaiting_authorisation", "authorised", "submitted", "pending", "confirmed"]),
  ));

  const policy = await loadPolicy(tx, ctx.businessId);
  const categories = (await tx.select({ c: procurementItems.category }).from(procurementItems)
    .where(eq(procurementItems.requestId, order.requestId))).map((r) => r.c).filter((c): c is string => !!c);
  const orderPolicy = evaluateOrderPolicy(
    policy, { supplierId: order.supplierId, total: { amount: order.totalAmount, currency: order.currency }, categories },
    await spentThisPeriod(tx, ctx.businessId, policy.currency, ctx.now),
  );

  // The practice session follows the real rule for the kind of checkout it stands in for.
  const limits = marketplace ? amazonCheckoutLimits(order.subtotal) : null;
  if (limits && exceedsCap(limits, order.totalAmount)) {
    throw new ServiceError("CHECKOUT_ABOVE_CAP", "With shipping and tax this order costs more than the checkout is allowed to charge, so it is refused.", 422);
  }
  const held = limits?.charge ?? order.totalAmount;
  const asset = order.paymentAsset;
  const fingerprint = await fingerprintFor(tx, order, recipient);

  const decision = evaluatePaymentExecution({
    now: ctx.now, amount: money(order.paymentAmount, asset), recipientAddress: recipient, approvedRecipientAddress: recipient,
    supplierRestricted: policy.restrictedSupplierIds.includes(order.supplierId),
    session: { status: "active", asset, remainingAmount: held, maxPerTransaction: held, expiresAt: new Date(ctx.now.getTime() + 30 * 60_000) },
    userApprovalRecorded: order.approvedBy !== null && order.approvedAt !== null,
    approvedOrderFingerprint: order.approvedFingerprint, currentOrderFingerprint: fingerprint,
    paymentAlreadyExecuted: live.length > 0, supportedAssets: [asset], orderPolicy,
  });
  if (!decision.allowed) {
    await recordAudit(tx, {
      businessId: ctx.businessId, actorType: "user", actorId: ctx.userId, action: "payment.checkout_blocked",
      resourceType: "purchase_order", resourceId: orderId, newState: { rejections: decision.rejections, simulated: true },
    });
    throw new ServiceError("CHECKOUT_BLOCKED", "The payment gate refused this checkout.", 422, {
      rejections: decision.rejections.map((code) => ({ code, message: REJECTION_MESSAGE[code] })),
    });
  }

  const reference = `SIM-${createHash("sha256").update(`${orderId}|${fingerprint}`).digest("hex").slice(0, 10).toUpperCase()}`;
  const [pay] = await tx.insert(payments).values({
    businessId: ctx.businessId, purchaseOrderId: orderId, supplierId: order.supplierId, spendingSessionId: null,
    idempotencyKey: `simulated:${orderId}`, recipientAddress: recipient, asset, network: SIMULATION_NETWORK,
    amount: order.paymentAmount, transactionHash: reference, providerReference: `simulated:${marketplace ? "amazon-checkout" : "direct"}`,
    status: "confirmed", confirmedAt: ctx.now,
  }).returning();
  if (!pay) throw new ServiceError("INTERNAL", "Could not record the practice payment.", 500);

  const settlement = limits ? settleCheckout(limits, order.totalAmount) : null;
  await recordAudit(tx, {
    businessId: ctx.businessId, actorType: "user", actorId: ctx.userId, action: "payment.simulated",
    resourceType: "payment", resourceId: pay.id,
    newState: { simulated: true, reference, recipient, fingerprint, held, ...(settlement ? { settled: settlement.settled, refunded: settlement.refunded } : {}) },
    metadata: { note: "Practice checkout. No money moved and nothing was ordered." },
  });

  return { paymentId: pay.id, reference, simulated: true, recipient, limits, settlement, marketplace };
}
