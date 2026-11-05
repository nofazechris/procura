import { and, eq, gte, inArray, ne } from "drizzle-orm";
import {
  approvals, nextDocumentNumber, procurementItems, procurementRequests, purchaseOrderItems, purchaseOrders,
  quotations, recordAudit, spendingPolicies, supplierPayoutDestinations, suppliers, type DbLike,
} from "@procura/database";
import {
  evaluateOrderPolicy, MARKETPLACE_RECIPIENT, orderFingerprint, type SpendingPolicy, type SpendingPolicyDecision,
} from "@procura/policies";
import {
  assertPurchaseOrderTransition, assertRequestTransition, PAYMENT_ASSET, PAYMENT_NETWORK, ServiceError, sum,
} from "@procura/shared";
import { buildPurchaseOrder, PurchaseOrderError, type ConversionRate } from "../purchase-order";
import type { ServiceContext } from "./context";
import { loadComparison, loadRequirement, rowToQuote } from "./comparison";

type PolicyRow = typeof spendingPolicies.$inferSelect;

function toPolicy(p: PolicyRow): SpendingPolicy {
  return {
    currency: p.currency, maxTotalSpend: p.maxTotalSpend, maxTransactionAmount: p.maxTransactionAmount,
    approvalRequired: p.approvalRequired, approvalRequiredAbove: p.approvalRequiredAbove,
    approvedSupplierIds: p.approvedSupplierIds, restrictedSupplierIds: p.restrictedSupplierIds,
    allowedCategories: p.allowedCategories, restrictedCategories: p.restrictedCategories,
  };
}

async function loadPolicy(tx: DbLike, businessId: string): Promise<SpendingPolicy> {
  const [p] = await tx.select().from(spendingPolicies).where(eq(spendingPolicies.businessId, businessId));
  if (!p) throw new ServiceError("NO_POLICY", "No spending policy is configured for this business.", 409);
  return toPolicy(p);
}

/** Spend counted against the budget: orders that are actually paid, in the policy currency, this UTC month. */
async function spentThisPeriod(tx: DbLike, businessId: string, currency: string, now: Date): Promise<string> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await tx.select({ total: purchaseOrders.totalAmount }).from(purchaseOrders).where(and(
    eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.currency, currency),
    inArray(purchaseOrders.status, ["paid", "processing", "fulfilled"]), gte(purchaseOrders.createdAt, monthStart),
  ));
  return sum(rows.map((r) => ({ amount: r.total, currency })), currency).amount;
}

export interface CreateOrderInput {
  requestId: string;
  quotationId: string;
  /** A total from the UI or a model. Checked against our own calculation, never used. */
  claimedTotal?: string;
  /** An explicit, timestamped rate. Used as given. */
  conversion?: ConversionRate;
  /**
   * Asked for a rate once the quote currency is known. Lets the server supply the rate without
   * guessing the currency up front. Ignored when `conversion` is given.
   */
  resolveConversion?: (quoteCurrency: string) => ConversionRate | undefined;
  /** A person confirms they reviewed a quote whose evidence is incomplete. Ineligible quotes can never be ordered. */
  acknowledgeReview?: boolean;
}

export async function createPurchaseOrder(tx: DbLike, ctx: ServiceContext, input: CreateOrderInput) {
  const { request, requirement, itemRows } = await loadRequirement(tx, ctx, input.requestId);

  if (request.status !== "comparing") {
    throw new ServiceError("INVALID_STATE", `Orders can only be created from a request that is being compared, not "${request.status}".`, 409);
  }

  const [quoteRow] = await tx.select().from(quotations).where(and(
    eq(quotations.id, input.quotationId), eq(quotations.requestId, input.requestId), eq(quotations.businessId, ctx.businessId),
  ));
  if (!quoteRow) throw new ServiceError("NOT_FOUND", "Quotation not found for this request.", 404);

  const open = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(
    eq(purchaseOrders.requestId, input.requestId), ne(purchaseOrders.status, "cancelled"), ne(purchaseOrders.status, "failed"),
  ));
  if (open.length > 0) throw new ServiceError("ORDER_EXISTS", "This request already has an open purchase order.", 409);

  // Eligibility is recomputed from stored records, not taken from the caller.
  const { comparison } = await loadComparison(tx, ctx, input.requestId);
  const row = comparison.rows.find((r) => r.quoteId === input.quotationId);
  if (!row) throw new ServiceError("NOT_FOUND", "Quotation not found in the comparison.", 404);
  if (row.verdict === "ineligible") {
    throw new ServiceError("QUOTE_INELIGIBLE", "This quotation does not meet the requirements.", 422, { reasons: row.eligibility.reasons });
  }
  if (row.verdict === "review_required" && !input.acknowledgeReview) {
    throw new ServiceError("REVIEW_REQUIRED", "This supplier has missing evidence. Confirm you reviewed it to continue.", 422, {
      reasons: row.eligibility.reasons, missingEvidence: row.eligibility.missingEvidence,
    });
  }

  const conversion = input.conversion ?? input.resolveConversion?.(requirement.currency);
  let draft;
  try {
    draft = buildPurchaseOrder({
      supplierId: quoteRow.supplierId, quote: rowToQuote(quoteRow), items: requirement.items,
      currency: requirement.currency, budget: requirement.budget,
      ...(input.claimedTotal !== undefined ? { claimedTotal: input.claimedTotal } : {}),
      paymentAsset: PAYMENT_ASSET, ...(conversion ? { conversion } : {}), now: ctx.now,
    });
  } catch (e) {
    if (e instanceof PurchaseOrderError) throw new ServiceError(e.code, e.message, 422);
    throw e;
  }

  const policy = await loadPolicy(tx, ctx.businessId);
  const categories = itemRows.map((i) => i.category).filter((c): c is string => !!c);
  const decision = evaluateOrderPolicy(
    policy, { supplierId: quoteRow.supplierId, total: { amount: draft.totalAmount, currency: draft.currency }, categories },
    await spentThisPeriod(tx, ctx.businessId, policy.currency, ctx.now),
  );
  if (!decision.allowed) {
    throw new ServiceError("POLICY_REJECTED", "The business spending policy does not allow this order.", 422, { reasonCodes: decision.reasonCodes });
  }

  assertPurchaseOrderTransition("draft", "pending_approval");
  assertRequestTransition("comparing", "awaiting_approval");

  const orderNumber = await nextDocumentNumber(tx, ctx.businessId, "purchase_order");
  const [po] = await tx.insert(purchaseOrders).values({
    businessId: ctx.businessId, requestId: request.id, supplierId: quoteRow.supplierId, quotationId: quoteRow.id,
    orderNumber, subtotal: draft.subtotal, deliveryCost: draft.deliveryCost, totalAmount: draft.totalAmount,
    currency: draft.currency, paymentAsset: draft.paymentAsset, paymentAmount: draft.paymentAmount,
    status: "pending_approval", paymentTerms: "Payable on authorisation", deliveryTerms: "Delivered to the stated location",
  }).returning();
  if (!po) throw new Error("Failed to create purchase order");

  await tx.insert(purchaseOrderItems).values(draft.lines.map((l) => ({
    businessId: ctx.businessId, purchaseOrderId: po.id, procurementItemId: l.requirementItemId,
    description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.totalPrice, currency: draft.currency,
  })));

  await tx.insert(approvals).values({
    businessId: ctx.businessId, purchaseOrderId: po.id, amount: draft.totalAmount, currency: draft.currency,
    status: "pending", reason: `Procura recommends ${orderNumber}. Payment needs a Passport spending session.`,
    expiresAt: new Date(ctx.now.getTime() + 7 * 24 * 60 * 60 * 1000),
  });

  await tx.update(quotations).set({ quoteStatus: "selected" }).where(eq(quotations.id, quoteRow.id));
  await tx.update(procurementRequests).set({ status: "awaiting_approval" }).where(eq(procurementRequests.id, request.id));

  await recordAudit(tx, {
    businessId: ctx.businessId, actorType: "user", actorId: ctx.userId, action: "order.created",
    resourceType: "purchase_order", resourceId: po.id,
    newState: { orderNumber, status: "pending_approval", total: `${draft.totalAmount} ${draft.currency}` },
    metadata: {
      quotationId: quoteRow.id, verdict: row.verdict, acknowledgedReview: !!input.acknowledgeReview,
      policyReasons: decision.reasonCodes,
      ...(draft.conversionUsed ? { conversion: { ...draft.conversionUsed, asOf: draft.conversionUsed.asOf.toISOString() } } : {}),
    },
  });

  return { order: po, lines: draft.lines, policy: decision };
}

/** Fingerprint of an order exactly as it is stored, plus the recipient it would be paid to. */
async function fingerprintFor(tx: DbLike, order: typeof purchaseOrders.$inferSelect, recipient: string): Promise<string> {
  const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, order.id));
  return orderFingerprint({
    supplierId: order.supplierId, currency: order.currency, paymentAsset: order.paymentAsset, recipientAddress: recipient,
    subtotal: order.subtotal, deliveryCost: order.deliveryCost, totalAmount: order.totalAmount,
    items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice })),
  });
}

/** Approved destination for this supplier, asset and network. Without one there is no one Procura may pay. */
async function approvedDestination(tx: DbLike, supplierId: string, asset: string) {
  const [d] = await tx.select().from(supplierPayoutDestinations).where(and(
    eq(supplierPayoutDestinations.supplierId, supplierId), eq(supplierPayoutDestinations.asset, asset),
    eq(supplierPayoutDestinations.network, PAYMENT_NETWORK), eq(supplierPayoutDestinations.status, "approved"),
  ));
  return d ?? null;
}

export interface ApprovalResult {
  orderId: string;
  fingerprint: string;
  recipientAddress: string;
  policy: SpendingPolicyDecision;
}

/**
 * A person approves the order. Records the fingerprint of everything payable, so any later change
 * (amount, items, recipient) voids the approval before money can move. Approving does NOT pay.
 */
export async function approveOrder(tx: DbLike, ctx: ServiceContext, orderId: string): Promise<ApprovalResult> {
  const [order] = await tx.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.businessId, ctx.businessId)));
  if (!order) throw new ServiceError("NOT_FOUND", "Purchase order not found.", 404);
  if (order.status !== "pending_approval") {
    throw new ServiceError("INVALID_STATE", `A purchase order that is "${order.status}" cannot be approved.`, 409);
  }

  const [approval] = await tx.select().from(approvals).where(and(
    eq(approvals.purchaseOrderId, orderId), eq(approvals.status, "pending"),
  ));
  if (!approval) throw new ServiceError("NO_PENDING_APPROVAL", "There is no pending approval for this order.", 409);
  if (approval.expiresAt && approval.expiresAt.getTime() <= ctx.now.getTime()) {
    await tx.update(approvals).set({ status: "expired" }).where(eq(approvals.id, approval.id));
    throw new ServiceError("APPROVAL_EXPIRED", "This approval request has expired.", 409);
  }

  // A marketplace order is paid at the marketplace's own checkout, so there is no payout address to approve.
  const [seller] = await tx.select({ sourceType: suppliers.sourceType }).from(suppliers).where(eq(suppliers.id, order.supplierId));
  const marketplace = seller?.sourceType === "marketplace";
  const destination = marketplace ? { address: MARKETPLACE_RECIPIENT } : await approvedDestination(tx, order.supplierId, order.paymentAsset);
  if (!destination) {
    throw new ServiceError("RECIPIENT_NOT_APPROVED", "Approve the seller's payment address before approving this order.", 409);
  }

  const policy = await loadPolicy(tx, ctx.businessId);
  const categories = (await tx.select({ c: procurementItems.category }).from(procurementItems)
    .where(eq(procurementItems.requestId, order.requestId))).map((r) => r.c).filter((c): c is string => !!c);
  const decision = evaluateOrderPolicy(
    policy, { supplierId: order.supplierId, total: { amount: order.totalAmount, currency: order.currency }, categories },
    await spentThisPeriod(tx, ctx.businessId, policy.currency, ctx.now),
  );
  if (!decision.allowed) {
    throw new ServiceError("POLICY_REJECTED", "The business spending policy no longer allows this order.", 422, { reasonCodes: decision.reasonCodes });
  }

  assertPurchaseOrderTransition("pending_approval", "approved");
  assertRequestTransition("awaiting_approval", "approved");
  const fingerprint = await fingerprintFor(tx, order, destination.address);

  await tx.update(purchaseOrders).set({
    status: "approved", approvedFingerprint: fingerprint, approvedBy: ctx.userId, approvedAt: ctx.now,
  }).where(eq(purchaseOrders.id, orderId));
  await tx.update(approvals).set({ status: "approved", decidedBy: ctx.userId, decidedAt: ctx.now }).where(eq(approvals.id, approval.id));
  await tx.update(procurementRequests).set({ status: "approved" }).where(eq(procurementRequests.id, order.requestId));

  await recordAudit(tx, {
    businessId: ctx.businessId, actorType: "user", actorId: ctx.userId, action: "order.approved",
    resourceType: "purchase_order", resourceId: orderId,
    previousState: { status: "pending_approval" }, newState: { status: "approved" },
    metadata: { fingerprint, recipient: destination.address, policyReasons: decision.reasonCodes },
  });

  return { orderId, fingerprint, recipientAddress: destination.address, policy: decision };
}

export async function rejectOrder(tx: DbLike, ctx: ServiceContext, orderId: string, reason?: string) {
  const [order] = await tx.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.businessId, ctx.businessId)));
  if (!order) throw new ServiceError("NOT_FOUND", "Purchase order not found.", 404);
  if (order.status !== "pending_approval") {
    throw new ServiceError("INVALID_STATE", `A purchase order that is "${order.status}" cannot be rejected.`, 409);
  }
  assertPurchaseOrderTransition("pending_approval", "cancelled");
  assertRequestTransition("awaiting_approval", "comparing");

  await tx.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, orderId));
  await tx.update(approvals).set({ status: "rejected", decidedBy: ctx.userId, decidedAt: ctx.now, reason: reason ?? null })
    .where(and(eq(approvals.purchaseOrderId, orderId), eq(approvals.status, "pending")));
  if (order.quotationId) await tx.update(quotations).set({ quoteStatus: "received" }).where(eq(quotations.id, order.quotationId));
  await tx.update(procurementRequests).set({ status: "comparing" }).where(eq(procurementRequests.id, order.requestId));

  await recordAudit(tx, {
    businessId: ctx.businessId, actorType: "user", actorId: ctx.userId, action: "order.rejected",
    resourceType: "purchase_order", resourceId: orderId,
    previousState: { status: "pending_approval" }, newState: { status: "cancelled" }, metadata: { reason: reason ?? null },
  });
}

/**
 * Only a person can approve where money may be sent. The agent can propose an address but can
 * never approve or change one (Technical PRD s13.3, s18.4).
 */
export async function approvePayoutDestination(tx: DbLike, ctx: ServiceContext, destinationId: string) {
  const [d] = await tx.select().from(supplierPayoutDestinations).where(and(
    eq(supplierPayoutDestinations.id, destinationId), eq(supplierPayoutDestinations.businessId, ctx.businessId),
  ));
  if (!d) throw new ServiceError("NOT_FOUND", "Payout destination not found.", 404);
  if (d.status === "approved") return d;
  if (d.status === "revoked") throw new ServiceError("INVALID_STATE", "A revoked destination cannot be re-approved. Add it again.", 409);

  // Only one approved destination per supplier, asset and network: approving a new one retires the old.
  await tx.update(supplierPayoutDestinations).set({ status: "revoked" }).where(and(
    eq(supplierPayoutDestinations.supplierId, d.supplierId), eq(supplierPayoutDestinations.asset, d.asset),
    eq(supplierPayoutDestinations.network, d.network), eq(supplierPayoutDestinations.status, "approved"),
  ));
  const [updated] = await tx.update(supplierPayoutDestinations)
    .set({ status: "approved", approvedBy: ctx.userId, approvedAt: ctx.now })
    .where(eq(supplierPayoutDestinations.id, destinationId)).returning();

  const [s] = await tx.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, d.supplierId));
  await recordAudit(tx, {
    businessId: ctx.businessId, actorType: "user", actorId: ctx.userId, action: "supplier.payout_destination.approved",
    resourceType: "supplier_payout_destination", resourceId: destinationId,
    newState: { address: d.address, network: d.network, asset: d.asset }, metadata: { supplier: s?.name ?? null },
  });
  return updated!;
}

// Re-exported so callers can build the same fingerprint at execution time (Phase 6).
export { fingerprintFor, approvedDestination, loadPolicy, spentThisPeriod };
