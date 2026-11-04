/** Status and role vocabularies. These mirror the Technical PRD s5 and are the single source of truth. */

export const MEMBER_ROLES = ["owner", "admin", "procurement_manager", "finance_manager", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const REQUEST_STATUSES = [
  "draft", "submitted", "analysing", "sourcing", "comparing", "awaiting_approval",
  "approved", "processing", "completed", "failed", "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const PO_STATUSES = [
  "draft", "pending_approval", "approved", "awaiting_payment", "payment_pending",
  "paid", "processing", "fulfilled", "disputed", "cancelled", "failed",
] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "prepared", "awaiting_authorisation", "authorised", "submitted", "pending",
  "confirmed", "failed", "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const SESSION_STATUSES = [
  "requested", "awaiting_user_approval", "active", "exhausted", "expired", "revoked", "failed",
] as const;
export type SpendingSessionStatus = (typeof SESSION_STATUSES)[number];

export const VERIFICATION_STATUSES = ["unknown", "unverified", "verified", "failed"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const EVIDENCE_TYPES = [
  "business_identity", "contact_information", "quotation", "product_availability",
  "delivery_history", "payment_destination", "transaction_history",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** "marketplace": a retailer listing bought through checkout (e.g. Amazon via Kite Passport), not a supplier we pay directly. */
export const SUPPLIER_SOURCE_TYPES = ["demo", "manual", "provider", "email", "marketplace"] as const;
export type SupplierSourceType = (typeof SUPPLIER_SOURCE_TYPES)[number];

export const AGENT_EVENT_TYPES = [
  "request_received", "requirements_analysed", "supplier_search_started", "supplier_found",
  "quotation_received", "supplier_evaluated", "comparison_completed", "recommendation_created",
  "purchase_order_created", "approval_requested", "session_created", "session_approved",
  "payment_submitted", "payment_pending", "payment_confirmed", "payment_failed",
  "procurement_completed", "procurement_failed",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const AGENT_TASK_STATUSES = ["queued", "running", "paused", "waiting_user", "completed", "failed", "cancelled"] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

export const PROCUREMENT_JOB_TYPES = [
  "analyse_request", "discover_suppliers", "collect_quotations", "evaluate_suppliers",
  "compare_quotations", "generate_recommendation", "create_purchase_order", "prepare_payment",
  "execute_payment", "verify_payment", "reconcile_transaction",
] as const;
export type ProcurementJobType = (typeof PROCUREMENT_JOB_TYPES)[number];

/** Payment asset and network used for supplier payments through Kite Passport. */
export const PAYMENT_ASSET = "USDC.e";
export const PAYMENT_NETWORK = "kite";
