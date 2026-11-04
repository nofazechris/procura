import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  AGENT_TASK_STATUSES, EVIDENCE_TYPES, MEMBER_ROLES, PAYMENT_STATUSES, PO_STATUSES, REQUEST_STATUSES,
  SESSION_STATUSES, SUPPLIER_SOURCE_TYPES, VERIFICATION_STATUSES, WALLET_STATUSES,
} from "@procura/shared";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
/** All money is NUMERIC(20,6), read and written as decimal strings. Never JS floats. */
const money = (name: string) => numeric(name, { precision: 20, scale: 6 });
const businessRef = () =>
  uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" });

/** DB-level guard that a text column holds one of the known statuses. Values are trusted constants. */
const oneOf = (col: AnyPgColumn, values: readonly string[]) =>
  sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

/* ------------------------------------------------------------------ */
/* Authentication (Better Auth, self-hosted on Neon)                   */
/* Column names follow Better Auth's default model.                    */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Tenancy                                                             */
/* ------------------------------------------------------------------ */

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    industry: text("industry"),
    countryCode: text("country_code").notNull(),
    defaultCurrency: text("default_currency").notNull(),
    website: text("website"),
    address: text("address"),
    /** Onboarding answers: categories, quality and delivery preferences, preferred suppliers, size. */
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export const businessMembers = pgTable(
  "business_members",
  {
    id: id(),
    businessId: businessRef(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBER_ROLES }).notNull(),
    status: text("status", { enum: ["active", "invited", "suspended"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("business_members_unique").on(t.businessId, t.userId),
    index("business_members_user_idx").on(t.userId),
    check("business_members_role_chk", oneOf(t.role, MEMBER_ROLES)),
  ],
);

/** Race-free, per-business sequential document numbers (PR-0001, PO-0001). */
export const documentCounters = pgTable(
  "document_counters",
  {
    businessId: businessRef(),
    kind: text("kind", { enum: ["procurement_request", "purchase_order"] }).notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [unique("document_counters_unique").on(t.businessId, t.kind)],
);

/* ------------------------------------------------------------------ */
/* Procurement                                                         */
/* ------------------------------------------------------------------ */

export const procurementRequests = pgTable(
  "procurement_requests",
  {
    id: id(),
    businessId: businessRef(),
    requestNumber: text("request_number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("draft"),
    budgetAmount: money("budget_amount").notNull(),
    currency: text("currency").notNull(),
    deliveryLocation: text("delivery_location"),
    deliveryDeadline: timestamp("delivery_deadline", { withTimezone: true }),
    priority: text("priority").notNull().default("price"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    /** Set once the agent task exists. Not a FK, to avoid a circular dependency with agent_tasks. */
    agentTaskId: uuid("agent_task_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("procurement_requests_number_unique").on(t.businessId, t.requestNumber),
    index("procurement_requests_business_status_idx").on(t.businessId, t.status),
    check("procurement_requests_status_chk", oneOf(t.status, REQUEST_STATUSES)),
    check("procurement_requests_budget_chk", sql`${t.budgetAmount} >= 0`),
  ],
);

export const procurementItems = pgTable(
  "procurement_items",
  {
    id: id(),
    businessId: businessRef(),
    requestId: uuid("request_id").notNull().references(() => procurementRequests.id, { onDelete: "cascade" }),
    productName: text("product_name").notNull(),
    description: text("description"),
    category: text("category"),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    unit: text("unit").notNull(),
    specifications: jsonb("specifications").$type<Record<string, unknown>>().notNull().default({}),
    preferredBrand: text("preferred_brand"),
    createdAt: createdAt(),
  },
  (t) => [
    index("procurement_items_request_idx").on(t.requestId),
    check("procurement_items_qty_chk", sql`${t.quantity} > 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* Suppliers, evidence and payout destinations                         */
/* ------------------------------------------------------------------ */

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    businessId: businessRef(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    description: text("description"),
    website: text("website"),
    countryCode: text("country_code"),
    city: text("city"),
    address: text("address"),
    email: text("email"),
    phone: text("phone"),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES }).notNull().default("unknown"),
    /** "demo" rows are fictional and must be labelled as such in every UI. */
    sourceType: text("source_type", { enum: SUPPLIER_SOURCE_TYPES }).notNull().default("manual"),
    /** The provider's own id, so re-running discovery updates a supplier instead of duplicating it. */
    externalRef: text("external_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("suppliers_business_idx").on(t.businessId),
    uniqueIndex("suppliers_external_unique")
      .on(t.businessId, t.sourceType, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    check("suppliers_verification_chk", oneOf(t.verificationStatus, VERIFICATION_STATUSES)),
  ],
);

export const supplierEvidence = pgTable(
  "supplier_evidence",
  {
    id: id(),
    businessId: businessRef(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    evidenceType: text("evidence_type", { enum: EVIDENCE_TYPES }).notNull(),
    sourceUrl: text("source_url"),
    sourceName: text("source_name").notNull(),
    evidenceData: jsonb("evidence_data").$type<Record<string, unknown>>().notNull().default({}),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES }).notNull().default("unknown"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    index("supplier_evidence_supplier_idx").on(t.supplierId),
    check("supplier_evidence_type_chk", oneOf(t.evidenceType, EVIDENCE_TYPES)),
  ],
);

/**
 * The only addresses Procura may pay for a supplier. Created and approved by a human; the agent
 * can never add or change one (Technical PRD s13.3, s18.4).
 */
export const supplierPayoutDestinations = pgTable(
  "supplier_payout_destinations",
  {
    id: id(),
    businessId: businessRef(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    network: text("network").notNull(),
    asset: text("asset").notNull(),
    status: text("status", { enum: ["pending", "approved", "revoked"] }).notNull().default("pending"),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("payout_destination_unique").on(t.supplierId, t.address, t.network),
    index("payout_destination_supplier_idx").on(t.supplierId),
  ],
);

export const quotations = pgTable(
  "quotations",
  {
    id: id(),
    businessId: businessRef(),
    requestId: uuid("request_id").notNull().references(() => procurementRequests.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    supplierQuoteReference: text("supplier_quote_reference"),
    subtotal: money("subtotal").notNull(),
    deliveryCost: money("delivery_cost").notNull().default("0"),
    additionalCosts: money("additional_costs").notNull().default("0"),
    totalCost: money("total_cost").notNull(),
    currency: text("currency").notNull(),
    /** Per-item pricing. Supplier-provided, so it is untrusted and validated on every read. */
    lineItems: jsonb("line_items").$type<{ description: string; quantity: string; unitPrice: string }[]>().notNull().default([]),
    /** Cost categories the supplier did not state (e.g. "delivery", "tax"). Zero here means "not stated". */
    unknownCosts: jsonb("unknown_costs").$type<string[]>().notNull().default([]),
    estimatedDeliveryDays: integer("estimated_delivery_days"),
    availabilityStatus: text("availability_status", { enum: ["available", "partial", "unavailable", "unknown"] })
      .notNull().default("unknown"),
    quoteStatus: text("quote_status", { enum: ["received", "expired", "rejected", "selected"] })
      .notNull().default("received"),
    sourceType: text("source_type", { enum: SUPPLIER_SOURCE_TYPES }).notNull().default("manual"),
    sourceEvidence: jsonb("source_evidence").$type<Record<string, unknown>>().notNull().default({}),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("quotations_request_idx").on(t.requestId),
    index("quotations_supplier_idx").on(t.supplierId),
    check("quotations_total_chk", sql`${t.totalCost} = ${t.subtotal} + ${t.deliveryCost} + ${t.additionalCosts}`),
  ],
);

/* ------------------------------------------------------------------ */
/* Purchase orders                                                     */
/* ------------------------------------------------------------------ */

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    businessId: businessRef(),
    requestId: uuid("request_id").notNull().references(() => procurementRequests.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    quotationId: uuid("quotation_id").references(() => quotations.id, { onDelete: "set null" }),
    orderNumber: text("order_number").notNull(),
    subtotal: money("subtotal").notNull(),
    deliveryCost: money("delivery_cost").notNull().default("0"),
    totalAmount: money("total_amount").notNull(),
    currency: text("currency").notNull(),
    paymentAsset: text("payment_asset").notNull(),
    paymentAmount: money("payment_amount").notNull(),
    status: text("status", { enum: PO_STATUSES }).notNull().default("draft"),
    paymentTerms: text("payment_terms"),
    deliveryTerms: text("delivery_terms"),
    /** Hash of the payable content at approval time. If it changes, the approval is void. */
    approvedFingerprint: text("approved_fingerprint"),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("purchase_orders_number_unique").on(t.businessId, t.orderNumber),
    index("purchase_orders_business_status_idx").on(t.businessId, t.status),
    check("purchase_orders_status_chk", oneOf(t.status, PO_STATUSES)),
    check("purchase_orders_total_chk", sql`${t.totalAmount} = ${t.subtotal} + ${t.deliveryCost}`),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: id(),
    businessId: businessRef(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    procurementItemId: uuid("procurement_item_id").references(() => procurementItems.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    unitPrice: money("unit_price").notNull(),
    totalPrice: money("total_price").notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [index("purchase_order_items_po_idx").on(t.purchaseOrderId)],
);

/* ------------------------------------------------------------------ */
/* Financial control                                                   */
/* ------------------------------------------------------------------ */

/** Application-level policy. Never a substitute for Kite Passport's own spending controls. */
export const spendingPolicies = pgTable(
  "spending_policies",
  {
    id: id(),
    businessId: businessRef().unique(),
    maxTotalSpend: money("max_total_spend").notNull(),
    maxTransactionAmount: money("max_transaction_amount").notNull(),
    currency: text("currency").notNull(),
    approvalRequired: boolean("approval_required").notNull().default(true),
    approvalRequiredAbove: money("approval_required_above"),
    approvedSupplierIds: jsonb("approved_supplier_ids").$type<string[]>().notNull().default([]),
    restrictedSupplierIds: jsonb("restricted_supplier_ids").$type<string[]>().notNull().default([]),
    allowedCategories: jsonb("allowed_categories").$type<string[]>().notNull().default([]),
    restrictedCategories: jsonb("restricted_categories").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("spending_policies_limits_chk", sql`${t.maxTransactionAmount} <= ${t.maxTotalSpend}`)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    businessId: businessRef(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "expired", "changes_requested"] })
      .notNull().default("pending"),
    reason: text("reason"),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_business_status_idx").on(t.businessId, t.status)],
);

export const spendingSessions = pgTable(
  "spending_sessions",
  {
    id: id(),
    businessId: businessRef(),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
    /** Reference returned by Kite Passport. We store references only, never keys or passkeys. */
    passportSessionReference: text("passport_session_reference"),
    /** Passport's id for the approval request, used to poll whether the person approved it. */
    passportRequestId: text("passport_request_id"),
    taskSummary: text("task_summary").notNull(),
    requestedAmount: money("requested_amount").notNull(),
    maxAmountPerTransaction: money("max_amount_per_transaction").notNull(),
    maxTotalAmount: money("max_total_amount").notNull(),
    asset: text("asset").notNull(),
    approvalUrl: text("approval_url"),
    status: text("status", { enum: SESSION_STATUSES }).notNull().default("requested"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("spending_sessions_business_idx").on(t.businessId, t.status),
    check("spending_sessions_status_chk", oneOf(t.status, SESSION_STATUSES)),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    businessId: businessRef(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
    spendingSessionId: uuid("spending_session_id").references(() => spendingSessions.id, { onDelete: "set null" }),
    /** Unique per payment attempt. Backed by a DB constraint so a retry can never double-spend. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    recipientAddress: text("recipient_address").notNull(),
    asset: text("asset").notNull(),
    network: text("network").notNull(),
    amount: money("amount").notNull(),
    transactionHash: text("transaction_hash"),
    providerReference: text("provider_reference"),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("prepared"),
    failureReason: text("failure_reason"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_business_status_idx").on(t.businessId, t.status),
    check("payments_status_chk", oneOf(t.status, PAYMENT_STATUSES)),
    check("payments_amount_chk", sql`${t.amount} > 0`),
    // Only a confirmed payment may carry a confirmation time, and a confirmed one must have a hash.
    check(
      "payments_confirmed_chk",
      sql`(${t.status} <> 'confirmed') or (${t.confirmedAt} is not null and ${t.transactionHash} is not null)`,
    ),
    // At most one live payment (in flight or confirmed) per purchase order. A failed or cancelled
    // attempt frees the slot; everything else blocks a duplicate.
    uniqueIndex("payments_one_live_per_po")
      .on(t.purchaseOrderId)
      .where(sql`${t.status} in ('prepared','awaiting_authorisation','authorised','submitted','pending','confirmed')`),
  ],
);

/* ------------------------------------------------------------------ */
/* Agent                                                               */
/* ------------------------------------------------------------------ */

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: id(),
    businessId: businessRef(),
    procurementRequestId: uuid("procurement_request_id").references(() => procurementRequests.id, { onDelete: "cascade" }),
    taskType: text("task_type").notNull(),
    status: text("status", { enum: AGENT_TASK_STATUSES }).notNull().default("queued"),
    currentStage: text("current_stage"),
    inputData: jsonb("input_data").$type<Record<string, unknown>>().notNull().default({}),
    outputData: jsonb("output_data").$type<Record<string, unknown>>().notNull().default({}),
    retryCount: integer("retry_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("agent_tasks_business_idx").on(t.businessId, t.status),
    index("agent_tasks_request_idx").on(t.procurementRequestId),
  ],
);

/** One row per workflow stage so a restarted worker can resume from the last safe state (s8.3). */
export const agentTaskStages = pgTable(
  "agent_task_stages",
  {
    id: id(),
    businessId: businessRef(),
    taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    status: text("status", { enum: ["pending", "running", "completed", "failed", "skipped"] }).notNull().default("pending"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    retryCount: integer("retry_count").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [unique("agent_task_stages_unique").on(t.taskId, t.stage)],
);

/** Append-only (enforced by a trigger in the guards migration). Persisted before broadcast. */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: id(),
    businessId: businessRef(),
    taskId: uuid("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    stage: text("stage"),
    message: text("message").notNull(),
    structuredData: jsonb("structured_data").$type<Record<string, unknown>>().notNull().default({}),
    evidenceReferences: jsonb("evidence_references").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("agent_events_task_idx").on(t.taskId, t.createdAt)],
);

/**
 * Procura's agent identity at Kite Passport. Passport issues the id when the agent is registered
 * under the owner's account; we keep the reference only, never a token or key.
 */
export const passportAgents = pgTable(
  "passport_agents",
  {
    id: id(),
    businessId: businessRef(),
    agentType: text("agent_type").notNull(),
    /** Passport's agent id, e.g. agent_01a1... */
    passportAgentId: text("passport_agent_id").notNull(),
    /** Passport's id for the owner account the agent is registered under. */
    passportOwnerId: text("passport_owner_id").notNull(),
    registeredBy: text("registered_by").notNull().references(() => user.id),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [unique("passport_agents_business_agent_uq").on(t.businessId, t.passportAgentId), index("passport_agents_business_idx").on(t.businessId)],
);

/**
 * Wallets a business has proven it controls, by signing a challenge. Addresses only: Procura never
 * stores keys, seed phrases or signatures that could be replayed. Revoked rows are kept for audit.
 */
export const businessWallets = pgTable(
  "business_wallets",
  {
    id: id(),
    businessId: businessRef(),
    linkedBy: text("linked_by").notNull().references(() => user.id),
    /** Lowercase 0x address. */
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    label: text("label"),
    status: text("status", { enum: WALLET_STATUSES }).notNull().default("active"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("business_wallets_active_uq").on(t.businessId, t.address, t.chainId).where(sql`${t.status} = 'active'`),
    index("business_wallets_business_idx").on(t.businessId, t.status),
    check("business_wallets_status_chk", oneOf(t.status, WALLET_STATUSES)),
    check("business_wallets_address_chk", sql`${t.address} ~ '^0x[0-9a-f]{40}$'`),
    check("business_wallets_revoked_chk", sql`(${t.status} = 'active') or (${t.revokedAt} is not null)`),
  ],
);

/** Append-only (trigger). Not editable by application users. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    businessId: businessRef(),
    actorType: text("actor_type", { enum: ["user", "agent", "system", "worker"] }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    previousState: jsonb("previous_state").$type<Record<string, unknown> | null>(),
    newState: jsonb("new_state").$type<Record<string, unknown> | null>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_business_idx").on(t.businessId, t.createdAt),
    index("audit_logs_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    businessId: businessRef(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: text("type").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

/** Tables that carry a business_id and are protected by Row Level Security. */
export const TENANT_TABLES = [
  "business_members", "document_counters", "procurement_requests", "procurement_items", "suppliers",
  "supplier_evidence", "supplier_payout_destinations", "quotations", "purchase_orders",
  "purchase_order_items", "spending_policies", "approvals", "spending_sessions", "payments",
  "agent_tasks", "agent_task_stages", "agent_events", "audit_logs", "notifications",
] as const;
