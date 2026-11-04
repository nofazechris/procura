import { add, compare, money, multiply, sum, toUnits, type Money } from "@procura/shared";
import type { Quote, RequirementItem } from "./types";

export type PurchaseOrderErrorCode =
  | "SUPPLIER_MISMATCH"
  | "QUOTE_NOT_ACTIVE"
  | "QUOTE_EXPIRED"
  | "CURRENCY_MISMATCH"
  | "MISSING_ITEMS"
  | "INSUFFICIENT_QUANTITY"
  | "QUOTE_INCONSISTENT"
  | "CLAIMED_TOTAL_MISMATCH"
  | "OVER_BUDGET"
  | "PAYMENT_CONVERSION_REQUIRED"
  | "STALE_CONVERSION_RATE";

export class PurchaseOrderError extends Error {
  constructor(public readonly code: PurchaseOrderErrorCode, message: string) {
    super(message);
    this.name = "PurchaseOrderError";
  }
}

export interface ConversionRate {
  /** Decimal string: payment-asset units per one unit of the quote currency. */
  rate: string;
  asOf: Date;
  source: string;
}

export interface BuildPurchaseOrderInput {
  supplierId: string;
  quote: Quote;
  items: RequirementItem[];
  currency: string;
  budget: string;
  /** A total supplied by the frontend or a model. Never used, only checked against our own. */
  claimedTotal?: string;
  paymentAsset: string;
  conversion?: ConversionRate;
  now: Date;
}

export interface PurchaseOrderDraft {
  currency: string;
  subtotal: string;
  deliveryCost: string;
  totalAmount: string;
  paymentAsset: string;
  paymentAmount: string;
  conversionUsed: ConversionRate | null;
  lines: {
    requirementItemId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    totalPrice: string;
  }[];
}

const MAX_RATE_AGE_MS = 60 * 60 * 1000;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Build a purchase order from a stored quotation, recalculating every figure from unit prices.
 * Totals from the frontend, a model, or even the supplier's own summary are never trusted
 * (Technical PRD s11.2): they are only compared against what we compute.
 */
export function buildPurchaseOrder(input: BuildPurchaseOrderInput): PurchaseOrderDraft {
  const { quote, now } = input;

  if (quote.supplierId !== input.supplierId) {
    throw new PurchaseOrderError("SUPPLIER_MISMATCH", "The quotation does not belong to this supplier.");
  }
  if (quote.status !== "received" && quote.status !== "selected") {
    throw new PurchaseOrderError("QUOTE_NOT_ACTIVE", `The quotation is ${quote.status}.`);
  }
  if (quote.validUntil && quote.validUntil.getTime() <= now.getTime()) {
    throw new PurchaseOrderError("QUOTE_EXPIRED", "The quotation has expired. Request a fresh quote.");
  }
  if (quote.currency !== input.currency) {
    throw new PurchaseOrderError("CURRENCY_MISMATCH", `Quote is in ${quote.currency}, request is in ${input.currency}.`);
  }

  const lines: PurchaseOrderDraft["lines"] = [];
  for (const item of input.items) {
    const q = quote.lines.find((l) => norm(l.description) === norm(item.name));
    if (!q) throw new PurchaseOrderError("MISSING_ITEMS", `The quotation does not price "${item.name}".`);
    if (toUnits(q.quantity) < toUnits(item.quantity)) {
      throw new PurchaseOrderError("INSUFFICIENT_QUANTITY", `"${item.name}": supplier quoted ${q.quantity}, ${item.quantity} needed.`);
    }
    const unit = money(q.unitPrice, input.currency);
    lines.push({
      requirementItemId: item.id,
      description: item.name,
      quantity: item.quantity,
      unitPrice: unit.amount,
      totalPrice: multiply(unit, item.quantity).amount,
    });
  }

  const additional = money(quote.additionalCosts, input.currency);
  if (toUnits(additional.amount) > 0) {
    lines.push({
      requirementItemId: null, description: "Additional charges (taxes and fees)", quantity: "1",
      unitPrice: additional.amount, totalPrice: additional.amount,
    });
  }

  const subtotal = sum(lines.map((l) => ({ amount: l.totalPrice, currency: input.currency })), input.currency);
  const delivery = money(quote.deliveryCost, input.currency);
  const total = add(subtotal, delivery);

  // The supplier's own stated numbers must agree with what their unit prices produce.
  const statedSubtotal = add(money(quote.subtotal, input.currency), additional);
  if (compare(statedSubtotal, subtotal) !== 0) {
    throw new PurchaseOrderError(
      "QUOTE_INCONSISTENT",
      `The quotation's stated subtotal (${statedSubtotal.amount}) does not match its unit prices (${subtotal.amount}).`,
    );
  }
  if (input.claimedTotal !== undefined && compare(money(input.claimedTotal, input.currency), total) !== 0) {
    throw new PurchaseOrderError(
      "CLAIMED_TOTAL_MISMATCH",
      `The supplied total (${input.claimedTotal}) does not match the calculated total (${total.amount}).`,
    );
  }
  if (compare(total, { amount: input.budget, currency: input.currency }) > 0) {
    throw new PurchaseOrderError("OVER_BUDGET", `Total ${total.amount} exceeds the budget ${input.budget}.`);
  }

  let paymentAmount: Money;
  let conversionUsed: ConversionRate | null = null;
  if (input.paymentAsset === input.currency) {
    paymentAmount = total;
  } else {
    if (!input.conversion) {
      throw new PurchaseOrderError(
        "PAYMENT_CONVERSION_REQUIRED",
        `Quote currency ${input.currency} differs from payment asset ${input.paymentAsset}. An explicit, timestamped rate is required.`,
      );
    }
    if (now.getTime() - input.conversion.asOf.getTime() > MAX_RATE_AGE_MS || input.conversion.asOf.getTime() > now.getTime()) {
      throw new PurchaseOrderError("STALE_CONVERSION_RATE", "The conversion rate is older than one hour.");
    }
    paymentAmount = multiply(total, input.conversion.rate);
    paymentAmount = { amount: paymentAmount.amount, currency: input.paymentAsset };
    conversionUsed = input.conversion;
  }

  return {
    currency: input.currency,
    subtotal: subtotal.amount,
    deliveryCost: delivery.amount,
    totalAmount: total.amount,
    paymentAsset: input.paymentAsset,
    paymentAmount: paymentAmount.amount,
    conversionUsed,
    lines,
  };
}
