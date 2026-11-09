import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  payments, procurementItems, procurementRequests, purchaseOrders, quotations, recordAudit, spendingSessions, suppliers, withTenant, type Tx,
} from "@procura/database";
import { fingerprintFor, linesForView, loadPolicy, REJECTION_MESSAGE, spentThisPeriod } from "@procura/procurement";
import {
  affordableCheckout, amazonCheckoutLimits, evaluateOrderPolicy, evaluatePaymentExecution, MARKETPLACE_RECIPIENT, type CheckoutLimits,
} from "@procura/policies";
import { assertPurchaseOrderTransition, assertRequestTransition, compare, money, ServiceError } from "@procura/shared";
import type { TenantAccess } from "../guard";
import { assertPassportEnabled } from "./passport";
import {
  cartAdd, cartClear, cartView, placeCheckout, shippingUpdate, shippingView, walletUsdc,
  type CheckoutResult, type ShippingInput, type ShippingProfile,
} from "./passport-shop";

/**
 * Real checkout of an approved Amazon order, paid from the Kite Passport wallet through a capped
 * spending session. Nothing here runs unless a person confirmed it, and Procura checks everything it
 * can first: the approval still matches the order to the cent, the limits, the wallet, the session,
 * and that the cart Passport holds is exactly the order. Passport then enforces its own limits again.
 */

const tenant = (a: TenantAccess) => ({ userId: a.userId, businessId: a.businessId });
const LIVE = ["prepared", "awaiting_authorisation", "authorised", "submitted", "pending", "confirmed"] as const;

interface OrderBundle {
  order: typeof purchaseOrders.$inferSelect;
  lines: { asin: string; quantity: number; unitPrice: string; title: string }[];
  categories: string[];
}

/** The order, with the exact Amazon products it was built from. Refuses anything that is not a clean, approved Amazon order. */
async function loadBundle(tx: Tx, access: TenantAccess, orderId: string): Promise<OrderBundle> {
  const [order] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.businessId, access.businessId)));
  if (!order) throw new ServiceError("NOT_FOUND", "Order not found.", 404);
  if (order.status !== "approved" && order.status !== "awaiting_payment") {
    throw new ServiceError("INVALID_STATE", `Only an approved order can be paid, not one that is "${order.status}".`, 409);
  }
  if (order.currency !== "USD") throw new ServiceError("CHECKOUT_USD_ONLY", "Checkout is priced in USD for now.", 422);
  const [seller] = await tx.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
  if (seller?.sourceType !== "marketplace") throw new ServiceError("CHECKOUT_NOT_AMAZON", "Only Amazon orders can be paid this way.", 422);
  if (!order.quotationId) throw new ServiceError("CHECKOUT_NO_LISTINGS", "This order has no listings behind it.", 422);
  const [quote] = await tx.select().from(quotations).where(eq(quotations.id, order.quotationId));
  const lines = quote ? linesForView(quote.lineItems) : [];
  const out: OrderBundle["lines"] = [];
  for (const l of lines) {
    const q = Number(l.quantity);
    if (!l.listing?.id || !Number.isInteger(q) || q < 1) throw new ServiceError("CHECKOUT_NO_LISTINGS", "This order has a line that cannot be matched to an Amazon product.", 422);
    out.push({ asin: l.listing.id, quantity: q, unitPrice: l.unitPrice, title: l.listing.title });
  }
  if (out.length === 0 || out.length > 10) throw new ServiceError("CHECKOUT_NO_LISTINGS", "An Amazon order holds between 1 and 10 different products.", 422);
  const cats = await tx.select({ c: procurementItems.category }).from(procurementItems).where(eq(procurementItems.requestId, order.requestId));
  return { order, lines: out, categories: cats.map((r) => r.c).filter((c): c is string => !!c) };
}

export interface LivePlan {
  subtotal: string;
  total: string;
  walletUsd: string | null;
  limits: CheckoutLimits | null;
  tightened: boolean;
  shortBy: string | null;
  lines: { title: string; quantity: number; unitPrice: string }[];
  shipping: ShippingProfile | null;
  sessions: { id: string; taskSummary: string; maxPerTx: string; maxTotal: string; expiresAt: string | null }[];
  /** Plain reasons the order cannot be paid yet. Empty means it can. */
  blockers: string[];
}

/** Reads, never spends: what paying this order for real would hold, and what is still missing. */
export async function planLiveCheckout(access: TenantAccess, orderId: string): Promise<LivePlan> {
  assertPassportEnabled(access.businessId);
  const now = new Date();
  const { bundle, sessions, live } = await withTenant(tenant(access), async (tx) => {
    const b = await loadBundle(tx, access, orderId);
    const rows = await tx.select().from(spendingSessions).where(and(eq(spendingSessions.businessId, access.businessId), eq(spendingSessions.status, "active")));
    const dup = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.purchaseOrderId, orderId), inArray(payments.status, [...LIVE]), ne(payments.network, "simulation")));
    return { bundle: b, sessions: rows, live: dup.some(() => true) };
  });
  const walletUsd = await walletUsdc();
  const shipping = await shippingView().catch(() => null);
  const blockers: string[] = [];
  const afford = walletUsd ? affordableCheckout(bundle.order.subtotal, walletUsd) : null;
  if (live) blockers.push("This order already has a payment.");
  if (!walletUsd) blockers.push("Your buyer's wallet balance could not be read. Try again in a moment.");
  else if (afford && !afford.ok) blockers.push(`Your buyer's wallet has $${Number(walletUsd).toFixed(2)}. This order needs at least $${(Number(bundle.order.subtotal) + 1).toFixed(2)} (the items plus the $1 fee), so add $${afford.shortBy} more.`);
  const limits = afford?.limits ?? null;
  const usable = limits
    ? sessions.filter((s) => s.passportSessionReference && (!s.expiresAt || s.expiresAt > now)
      && compare(money(s.maxAmountPerTransaction, "USD"), money(limits.charge, "USD")) >= 0 && compare(money(s.maxTotalAmount, "USD"), money(limits.charge, "USD")) >= 0)
    : [];
  if (limits && usable.length === 0) blockers.push(`You need an approved spending session of at least $${limits.charge} (per payment and in total). Request one, then come back.`);
  return {
    subtotal: bundle.order.subtotal, total: bundle.order.totalAmount, walletUsd, limits, tightened: afford?.tightened ?? false, shortBy: afford?.shortBy ?? null,
    lines: bundle.lines.map((l) => ({ title: l.title, quantity: l.quantity, unitPrice: l.unitPrice })), shipping,
    sessions: usable.map((s) => ({ id: s.id, taskSummary: s.taskSummary, maxPerTx: s.maxAmountPerTransaction, maxTotal: s.maxTotalAmount, expiresAt: s.expiresAt?.toISOString() ?? null })),
    blockers,
  };
}

export interface LiveInput { sessionId: string; maxTotal?: string; shipping?: ShippingInput; confirmed: boolean }

export interface LiveReceipt {
  paymentId: string;
  orderId: string;
  status: "paid" | "pending";
  orderStatus: string;
  txHash: string | null;
  held: string;
  ceiling: string;
  note: string;
}

/** Pays an approved Amazon order for real. Throws a plain error for anything Procura can catch before any money moves. */
export async function runLiveCheckout(access: TenantAccess, orderId: string, input: LiveInput): Promise<LiveReceipt> {
  assertPassportEnabled(access.businessId);
  if (!input.confirmed) throw new ServiceError("NOT_CONFIRMED", "Confirm the payment first. Nothing was charged.", 422);
  const now = new Date();

  const { bundle, session, policy, spent, live } = await withTenant(tenant(access), async (tx) => {
    const b = await loadBundle(tx, access, orderId);
    const [s] = await tx.select().from(spendingSessions).where(and(eq(spendingSessions.id, input.sessionId), eq(spendingSessions.businessId, access.businessId)));
    const p = await loadPolicy(tx, access.businessId);
    const dup = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.purchaseOrderId, orderId), inArray(payments.status, [...LIVE]), ne(payments.network, "simulation")));
    return { bundle: b, session: s ?? null, policy: p, spent: await spentThisPeriod(tx, access.businessId, p.currency, now), live: dup.length > 0 };
  });
  const order = bundle.order;

  // 1. The money: the wallet must hold the whole up-front charge.
  const wallet = await walletUsdc();
  if (!wallet) throw new ServiceError("WALLET_UNREADABLE", "Could not read your buyer's wallet. Nothing was charged. Try again in a moment.", 503);
  let limits: CheckoutLimits;
  if (input.maxTotal !== undefined) {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(input.maxTotal)) throw new ServiceError("CEILING_INVALID", "Enter a ceiling such as 18.50.", 422);
    try { limits = amazonCheckoutLimits(order.subtotal, input.maxTotal); } catch { throw new ServiceError("CEILING_TOO_LOW", "The ceiling cannot be below the price of the items.", 422); }
  } else {
    const a = affordableCheckout(order.subtotal, wallet);
    if (!a.ok || !a.limits) throw new ServiceError("WALLET_TOO_LOW", `Your buyer's wallet needs $${a.shortBy} more to cover this order. Nothing was charged.`, 409);
    limits = a.limits;
  }
  if (compare(money(limits.charge, "USD"), money(wallet, "USD")) > 0) {
    throw new ServiceError("WALLET_TOO_LOW", `This order holds $${limits.charge} up front and your buyer's wallet has $${Number(wallet).toFixed(2)}. Nothing was charged.`, 409);
  }

  // 2. The session: approved, live, and big enough for the whole up-front charge.
  if (!session || session.status !== "active" || !session.passportSessionReference) throw new ServiceError("SESSION_NOT_ACTIVE", "That spending session is not approved and active.", 409);
  if (session.expiresAt && session.expiresAt.getTime() <= now.getTime()) throw new ServiceError("SESSION_EXPIRED", "That spending session has expired. Ask for a new one.", 409);
  if (compare(money(session.maxAmountPerTransaction, "USD"), money(limits.charge, "USD")) < 0 || compare(money(session.maxTotalAmount, "USD"), money(limits.charge, "USD")) < 0) {
    throw new ServiceError("SESSION_TOO_SMALL", `That session is smaller than the $${limits.charge} this order holds up front. Request a bigger one.`, 409);
  }

  // 3. Procura's own gate: the approval must still match the order, to the cent.
  const fingerprint = await withTenant(tenant(access), (tx) => fingerprintFor(tx, order, MARKETPLACE_RECIPIENT));
  const orderPolicy = evaluateOrderPolicy(policy, { supplierId: order.supplierId, total: { amount: order.totalAmount, currency: order.currency }, categories: bundle.categories }, spent);
  const decision = evaluatePaymentExecution({
    now, amount: money(limits.charge, "USD"), recipientAddress: MARKETPLACE_RECIPIENT, approvedRecipientAddress: MARKETPLACE_RECIPIENT,
    supplierRestricted: policy.restrictedSupplierIds.includes(order.supplierId),
    session: { status: "active", asset: "USD", remainingAmount: session.maxTotalAmount, maxPerTransaction: session.maxAmountPerTransaction, expiresAt: session.expiresAt ?? new Date(now.getTime() + 3_600_000) },
    userApprovalRecorded: order.approvedBy !== null && order.approvedAt !== null,
    approvedOrderFingerprint: order.approvedFingerprint, currentOrderFingerprint: fingerprint, paymentAlreadyExecuted: live, supportedAssets: ["USD"], orderPolicy,
  });
  if (!decision.allowed) {
    await audit(access, "payment.checkout_blocked", orderId, { rejections: decision.rejections, live: true });
    throw new ServiceError("CHECKOUT_BLOCKED", "The payment gate refused this checkout. Nothing was charged.", 422, {
      rejections: decision.rejections.map((code) => ({ code, message: REJECTION_MESSAGE[code] })),
    });
  }

  // 4. Delivery details and the cart: what Passport holds must be exactly this order.
  if (input.shipping) await shippingUpdate(input.shipping);
  const ship = await shippingView();
  if (!ship.complete) throw new ServiceError("SHIPPING_INCOMPLETE", `Add your delivery details first (${ship.missing.join(", ") || "something is missing"}). Nothing was charged.`, 422, { missing: ship.missing });
  await cartClear();
  try {
    for (const l of bundle.lines) await cartAdd(l.asin, l.quantity);
    const cart = await cartView();
    const same = cart.length === bundle.lines.length && bundle.lines.every((l) => {
      const c = cart.find((x) => x.externalId === l.asin);
      return c !== undefined && c.quantity === l.quantity && c.price !== null && compare(money(c.price, "USD"), money(l.unitPrice, "USD")) === 0;
    });
    if (!same) throw new ServiceError("PRICES_CHANGED", "Amazon's prices or items changed since you compared. Search again so you pay what you saw. Nothing was charged.", 409);
  } catch (e) { await cartClear().catch(() => undefined); throw e; }

  // 5. Record the attempt before any money can move, so a crash can never allow a second payment.
  const paymentId = await withTenant(tenant(access), async (tx) => {
    assertPurchaseOrderTransition(order.status, order.status === "approved" ? "awaiting_payment" : "payment_pending");
    if (order.status === "approved") await tx.update(purchaseOrders).set({ status: "awaiting_payment" }).where(eq(purchaseOrders.id, orderId));
    assertPurchaseOrderTransition("awaiting_payment", "payment_pending");
    await tx.update(purchaseOrders).set({ status: "payment_pending" }).where(eq(purchaseOrders.id, orderId));
    const [pay] = await tx.insert(payments).values({
      businessId: access.businessId, purchaseOrderId: orderId, supplierId: order.supplierId, spendingSessionId: session.id,
      idempotencyKey: `live:${orderId}:${randomUUID()}`, recipientAddress: MARKETPLACE_RECIPIENT, asset: "USDC", network: "base",
      amount: limits.charge, status: "submitted", providerReference: "amazon-checkout",
    }).returning();
    if (!pay) throw new ServiceError("INTERNAL", "Could not record the payment.", 500);
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "payment.live_submitted", resourceType: "payment", resourceId: pay.id,
      newState: { orderId, held: limits.charge, ceiling: limits.cap, fee: limits.fee, sessionId: session.id, fingerprint },
    });
    return pay.id;
  }).catch((e: unknown) => {
    if (e instanceof ServiceError) throw e;
    // The one-live-payment-per-order index: someone already started this payment.
    throw new ServiceError("PAYMENT_EXISTS", "This order already has a payment in progress.", 409);
  });

  // 6. Pay.
  const result = await placeCheckout({ sessionId: session.passportSessionReference, maxTotal: limits.cap });
  await cartClear().catch(() => undefined);
  return await settle(access, order.id, order.requestId, paymentId, result, limits);
}

async function settle(access: TenantAccess, orderId: string, requestId: string, paymentId: string, r: CheckoutResult, limits: CheckoutLimits): Promise<LiveReceipt> {
  const now = new Date();
  if (r.ok) {
    const failedByProvider = r.orderStatus === "failed" || r.orderStatus === "refunded";
    await withTenant(tenant(access), async (tx) => {
      if (failedByProvider) {
        await tx.update(payments).set({ status: "failed", failureReason: `The retailer ${r.orderStatus} the order. The up-front charge is refunded.`, providerReference: r.orderId }).where(eq(payments.id, paymentId));
        assertPurchaseOrderTransition("payment_pending", "failed");
        await tx.update(purchaseOrders).set({ status: "failed" }).where(eq(purchaseOrders.id, orderId));
      } else {
        await tx.update(payments).set(r.txHash
          ? { status: "confirmed", transactionHash: r.txHash, confirmedAt: now, providerReference: r.orderId, network: r.chain ?? "base" }
          : { status: "pending", providerReference: r.orderId }).where(eq(payments.id, paymentId));
        if (r.txHash) {
          assertPurchaseOrderTransition("payment_pending", "paid");
          await tx.update(purchaseOrders).set({ status: "paid" }).where(eq(purchaseOrders.id, orderId));
          assertRequestTransition("approved", "processing");
          await tx.update(procurementRequests).set({ status: "processing" }).where(eq(procurementRequests.id, requestId));
        }
      }
      await recordAudit(tx, {
        businessId: access.businessId, actorType: "user", actorId: access.userId, action: failedByProvider ? "payment.live_failed" : "payment.live_confirmed",
        resourceType: "payment", resourceId: paymentId,
        newState: { orderId, kiteOrderId: r.orderId, orderStatus: r.orderStatus, txHash: r.txHash, totalAmount: r.totalAmount, ceiling: limits.cap },
      });
    });
    if (failedByProvider) throw new ServiceError("ORDER_FAILED", `Amazon ${r.orderStatus} the order. The up-front charge is refunded to your buyer's wallet.`, 502);
    return {
      paymentId, orderId: r.orderId, status: r.txHash ? "paid" : "pending", orderStatus: r.orderStatus, txHash: r.txHash, held: limits.charge, ceiling: limits.cap,
      note: r.orderStatus === "completed" ? "The order is placed. What it did not use comes back to your buyer's wallet." : "The order is being placed. Check its status in a minute.",
    };
  }

  // A failure. Where the outcome is unknown the payment stays pending so nobody pays twice; otherwise it is failed and can be retried.
  const unknown = r.kind === "in_flight" || r.kind === "pending" || r.kind === "unreadable";
  await withTenant(tenant(access), async (tx) => {
    if (unknown) await tx.update(payments).set({ status: "pending", failureReason: r.message }).where(eq(payments.id, paymentId));
    else {
      await tx.update(payments).set({ status: "failed", failureReason: r.message }).where(eq(payments.id, paymentId));
      assertPurchaseOrderTransition("payment_pending", "awaiting_payment");
      await tx.update(purchaseOrders).set({ status: "awaiting_payment" }).where(eq(purchaseOrders.id, orderId));
    }
    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId, action: "payment.live_failed", resourceType: "payment", resourceId: paymentId,
      newState: { orderId, kind: r.kind, code: r.code, unknown },
    });
  });
  throw new ServiceError(unknown ? "PAYMENT_UNKNOWN" : "CHECKOUT_FAILED", r.message, unknown ? 202 : 502, { kind: r.kind });
}

async function audit(access: TenantAccess, action: string, orderId: string, newState: Record<string, unknown>) {
  await withTenant(tenant(access), (tx) =>
    recordAudit(tx, { businessId: access.businessId, actorType: "user", actorId: access.userId, action, resourceType: "purchase_order", resourceId: orderId, newState }));
}
