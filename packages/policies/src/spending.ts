import { compare, subtract, add, type Money, type SpendingSessionStatus } from "@procura/shared";

/**
 * Financial Policy Engine (Technical PRD s13).
 *
 * Independent of any AI model. Every function is pure and deterministic. A model-generated
 * instruction cannot override any restriction here, because the model never calls these
 * functions with its own inputs: callers load all inputs from the database.
 */

export interface SpendingPolicy {
  currency: string;
  /** Business-wide ceiling for the budget period. */
  maxTotalSpend: string;
  maxTransactionAmount: string;
  /** Orders above this need explicit user approval. When absent, every order needs approval. */
  approvalRequiredAbove?: string | null;
  approvalRequired: boolean;
  /** Empty means "no allow-list": any non-restricted supplier is permitted. */
  approvedSupplierIds: string[];
  restrictedSupplierIds: string[];
  allowedCategories: string[];
  restrictedCategories: string[];
}

export interface OrderForPolicy {
  supplierId: string;
  total: Money;
  categories: string[];
}

export interface SpendingPolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reasonCodes: PolicyReasonCode[];
  /** The most this policy would allow for this order right now. */
  maxAllowedAmount: string;
  currency: string;
}

export type PolicyReasonCode =
  | "WITHIN_BUSINESS_BUDGET"
  | "EXCEEDS_BUSINESS_BUDGET"
  | "WITHIN_TRANSACTION_LIMIT"
  | "EXCEEDS_TRANSACTION_LIMIT"
  | "SUPPLIER_ALLOWED"
  | "SUPPLIER_RESTRICTED"
  | "SUPPLIER_NOT_APPROVED"
  | "CATEGORY_ALLOWED"
  | "CATEGORY_RESTRICTED"
  | "CATEGORY_NOT_ALLOWED"
  | "CURRENCY_MISMATCH"
  | "APPROVAL_REQUIRED"
  | "PASSPORT_SESSION_REQUIRED";

/**
 * Pre-session check: may this order be sent for approval and funded at all?
 * `spentThisPeriod` is loaded from confirmed payments only.
 */
export function evaluateOrderPolicy(
  policy: SpendingPolicy,
  order: OrderForPolicy,
  spentThisPeriod: string,
): SpendingPolicyDecision {
  const reasons: PolicyReasonCode[] = [];
  let allowed = true;

  if (order.total.currency !== policy.currency) {
    // No implicit conversion: amounts in different currencies are never compared.
    return {
      allowed: false,
      requiresApproval: true,
      reasonCodes: ["CURRENCY_MISMATCH"],
      maxAllowedAmount: "0.00",
      currency: policy.currency,
    };
  }

  const spent: Money = { amount: spentThisPeriod, currency: policy.currency };
  const ceiling: Money = { amount: policy.maxTotalSpend, currency: policy.currency };
  const perTx: Money = { amount: policy.maxTransactionAmount, currency: policy.currency };
  const remaining = subtract(ceiling, spent);

  if (compare(add(spent, order.total), ceiling) <= 0) reasons.push("WITHIN_BUSINESS_BUDGET");
  else { reasons.push("EXCEEDS_BUSINESS_BUDGET"); allowed = false; }

  if (compare(order.total, perTx) <= 0) reasons.push("WITHIN_TRANSACTION_LIMIT");
  else { reasons.push("EXCEEDS_TRANSACTION_LIMIT"); allowed = false; }

  if (policy.restrictedSupplierIds.includes(order.supplierId)) {
    reasons.push("SUPPLIER_RESTRICTED"); allowed = false;
  } else if (policy.approvedSupplierIds.length > 0 && !policy.approvedSupplierIds.includes(order.supplierId)) {
    reasons.push("SUPPLIER_NOT_APPROVED"); allowed = false;
  } else reasons.push("SUPPLIER_ALLOWED");

  const blockedCategory = order.categories.some((c) => policy.restrictedCategories.includes(c));
  const outsideAllowList =
    policy.allowedCategories.length > 0 && order.categories.some((c) => !policy.allowedCategories.includes(c));
  if (blockedCategory) { reasons.push("CATEGORY_RESTRICTED"); allowed = false; }
  else if (outsideAllowList) { reasons.push("CATEGORY_NOT_ALLOWED"); allowed = false; }
  else reasons.push("CATEGORY_ALLOWED");

  const needsApproval =
    policy.approvalRequired ||
    !policy.approvalRequiredAbove ||
    compare(order.total, { amount: policy.approvalRequiredAbove, currency: policy.currency }) > 0;
  // Spending always needs a Passport session, whatever the threshold. The threshold only decides
  // whether Procura asks for an additional in-app sign-off before requesting one.
  if (needsApproval) reasons.push("APPROVAL_REQUIRED");
  reasons.push("PASSPORT_SESSION_REQUIRED");

  const cap = compare(remaining, perTx) < 0 ? remaining : perTx;
  const maxAllowed = compare(cap, { amount: "0", currency: policy.currency }) < 0 ? "0.00" : cap.amount;

  return {
    allowed,
    requiresApproval: needsApproval,
    reasonCodes: reasons,
    maxAllowedAmount: maxAllowed,
    currency: policy.currency,
  };
}

/* ------------------------------------------------------------------ */
/* Execution gate: the hard restrictions of Technical PRD s13.3 / s12.9 */
/* ------------------------------------------------------------------ */

export interface ExecutionSession {
  status: SpendingSessionStatus;
  asset: string;
  remainingAmount: string;
  maxPerTransaction: string;
  expiresAt: Date;
}

export interface ExecutionInput {
  now: Date;
  /** The payment amount in the payment asset (e.g. USDC.e). */
  amount: Money;
  recipientAddress: string;
  /** Recipient stored and verified against the supplier before authorisation. */
  approvedRecipientAddress: string | null;
  supplierRestricted: boolean;
  session: ExecutionSession | null;
  userApprovalRecorded: boolean;
  /** Fingerprint of the PO the user approved vs. the PO as it is now. */
  approvedOrderFingerprint: string | null;
  currentOrderFingerprint: string;
  paymentAlreadyExecuted: boolean;
  supportedAssets: string[];
  orderPolicy: SpendingPolicyDecision;
}

export type ExecutionRejection =
  | "POLICY_NOT_ALLOWED"
  | "SUPPLIER_RESTRICTED"
  | "SESSION_MISSING"
  | "SESSION_NOT_ACTIVE"
  | "SESSION_EXPIRED"
  | "SESSION_ASSET_MISMATCH"
  | "SESSION_BUDGET_INSUFFICIENT"
  | "SESSION_TX_LIMIT_EXCEEDED"
  | "RECIPIENT_NOT_APPROVED"
  | "RECIPIENT_MISMATCH"
  | "ORDER_CHANGED_AFTER_APPROVAL"
  | "DUPLICATE_PAYMENT"
  | "UNSUPPORTED_ASSET"
  | "USER_APPROVAL_MISSING";

export interface ExecutionDecision {
  allowed: boolean;
  rejections: ExecutionRejection[];
}

/** Returns every violated restriction, not just the first, so audit logs are complete. */
export function evaluatePaymentExecution(input: ExecutionInput): ExecutionDecision {
  const r: ExecutionRejection[] = [];
  const { session } = input;

  if (!input.orderPolicy.allowed) r.push("POLICY_NOT_ALLOWED");
  if (input.supplierRestricted) r.push("SUPPLIER_RESTRICTED");
  if (!input.supportedAssets.includes(input.amount.currency)) r.push("UNSUPPORTED_ASSET");
  if (!input.userApprovalRecorded) r.push("USER_APPROVAL_MISSING");
  if (input.paymentAlreadyExecuted) r.push("DUPLICATE_PAYMENT");

  if (!input.approvedOrderFingerprint || input.approvedOrderFingerprint !== input.currentOrderFingerprint) {
    r.push("ORDER_CHANGED_AFTER_APPROVAL");
  }

  if (!input.approvedRecipientAddress) r.push("RECIPIENT_NOT_APPROVED");
  else if (input.approvedRecipientAddress.toLowerCase() !== input.recipientAddress.toLowerCase()) {
    r.push("RECIPIENT_MISMATCH");
  }

  if (!session) {
    r.push("SESSION_MISSING");
  } else {
    if (session.status !== "active") r.push("SESSION_NOT_ACTIVE");
    if (session.expiresAt.getTime() <= input.now.getTime()) r.push("SESSION_EXPIRED");
    if (session.asset !== input.amount.currency) r.push("SESSION_ASSET_MISMATCH");
    else {
      if (compare(input.amount, { amount: session.remainingAmount, currency: session.asset }) > 0) {
        r.push("SESSION_BUDGET_INSUFFICIENT");
      }
      if (compare(input.amount, { amount: session.maxPerTransaction, currency: session.asset }) > 0) {
        r.push("SESSION_TX_LIMIT_EXCEEDED");
      }
    }
  }

  return { allowed: r.length === 0, rejections: r };
}
