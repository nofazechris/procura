import type { SupplierEvidenceSummary } from "@procura/shared";

export interface RequirementItem {
  id: string;
  name: string;
  /** Decimal string. */
  quantity: string;
}

/** What the business asked for. Loaded from the database, never from model output. */
export interface Requirement {
  currency: string;
  /** Decimal string budget, delivered cost included. */
  budget: string;
  /** null when the request states no deadline. */
  maxDeliveryDays: number | null;
  items: RequirementItem[];
}

export interface QuoteLine {
  description: string;
  quantity: string;
  unitPrice: string;
}

/** A quotation as stored. `lineItems` came from a supplier, so it is parsed before use. */
export interface Quote {
  id: string;
  supplierId: string;
  currency: string;
  lines: QuoteLine[];
  subtotal: string;
  deliveryCost: string;
  additionalCosts: string;
  totalCost: string;
  unknownCosts: string[];
  estimatedDeliveryDays: number | null;
  availability: "available" | "partial" | "unavailable" | "unknown";
  status: "received" | "expired" | "rejected" | "selected";
  validUntil: Date | null;
}

export type EligibilityVerdict = "eligible" | "review_required" | "ineligible";

export type EligibilityReason =
  | "CURRENCY_MISMATCH"
  | "QUOTE_NOT_ACTIVE"
  | "QUOTE_EXPIRED"
  | "UNAVAILABLE"
  | "PARTIAL_AVAILABILITY"
  | "AVAILABILITY_UNKNOWN"
  | "MISSING_ITEMS"
  | "INSUFFICIENT_QUANTITY"
  | "OVER_BUDGET"
  | "LATE_DELIVERY"
  | "DELIVERY_UNKNOWN"
  | "SUPPLIER_RESTRICTED"
  | "IDENTITY_NOT_VERIFIED"
  | "IDENTITY_FAILED"
  | "CONTACT_NOT_VERIFIED"
  | "PAYMENT_DESTINATION_NOT_VERIFIED"
  | "PAYMENT_DESTINATION_MISMATCH";

export interface Eligibility {
  quoteId: string;
  supplierId: string;
  verdict: EligibilityVerdict;
  /** Everything that blocked or flagged this quote. Empty only for a clean "eligible". */
  reasons: EligibilityReason[];
  /** Soft concerns that do not block eligibility (e.g. no delivery history yet). */
  concerns: string[];
  /** Evidence we do not have. Missing is unknown, never success. */
  missingEvidence: string[];
}

/**
 * How money reaches this supplier. A direct supplier is paid to a payout address a person approved, so
 * its contact and payout address must be verified. A marketplace is paid through its checkout provider,
 * which takes the payment itself, so those two checks do not apply to it.
 */
export type PaymentRoute = "supplier_payout" | "marketplace_checkout";

export interface SupplierContext {
  supplierId: string;
  restricted: boolean;
  evidence: SupplierEvidenceSummary;
  /** Defaults to a direct supplier payout, the stricter route. */
  paymentRoute?: PaymentRoute;
}

export type Priority = "price" | "reliability" | "speed" | "quality";
