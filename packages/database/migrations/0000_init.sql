CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"stage" text,
	"message" text NOT NULL,
	"structured_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_task_stages_unique" UNIQUE("task_id","stage")
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"procurement_request_id" uuid,
	"task_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"current_stage" text,
	"input_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"previous_state" jsonb,
	"new_state" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_members_unique" UNIQUE("business_id","user_id"),
	CONSTRAINT "business_members_role_chk" CHECK ("business_members"."role" in ('owner', 'admin', 'procurement_manager', 'finance_manager', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"industry" text,
	"country_code" text NOT NULL,
	"default_currency" text NOT NULL,
	"website" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "document_counters" (
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_counters_unique" UNIQUE("business_id","kind")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"spending_session_id" uuid,
	"idempotency_key" text NOT NULL,
	"recipient_address" text NOT NULL,
	"asset" text NOT NULL,
	"network" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"transaction_hash" text,
	"provider_reference" text,
	"status" text DEFAULT 'prepared' NOT NULL,
	"failure_reason" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_status_chk" CHECK ("payments"."status" in ('prepared', 'awaiting_authorisation', 'authorised', 'submitted', 'pending', 'confirmed', 'failed', 'cancelled')),
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_confirmed_chk" CHECK (("payments"."status" <> 'confirmed') or ("payments"."confirmed_at" is not null and "payments"."transaction_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "procurement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"description" text,
	"category" text,
	"quantity" numeric(20, 6) NOT NULL,
	"unit" text NOT NULL,
	"specifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferred_brand" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_items_qty_chk" CHECK ("procurement_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "procurement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"request_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"budget_amount" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"delivery_location" text,
	"delivery_deadline" timestamp with time zone,
	"priority" text DEFAULT 'price' NOT NULL,
	"requested_by" text,
	"agent_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_requests_number_unique" UNIQUE("business_id","request_number"),
	CONSTRAINT "procurement_requests_status_chk" CHECK ("procurement_requests"."status" in ('draft', 'submitted', 'analysing', 'sourcing', 'comparing', 'awaiting_approval', 'approved', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "procurement_requests_budget_chk" CHECK ("procurement_requests"."budget_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"procurement_item_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"total_price" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"quotation_id" uuid,
	"order_number" text NOT NULL,
	"subtotal" numeric(20, 6) NOT NULL,
	"delivery_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_amount" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"payment_asset" text NOT NULL,
	"payment_amount" numeric(20, 6) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_terms" text,
	"delivery_terms" text,
	"approved_fingerprint" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("business_id","order_number"),
	CONSTRAINT "purchase_orders_status_chk" CHECK ("purchase_orders"."status" in ('draft', 'pending_approval', 'approved', 'awaiting_payment', 'payment_pending', 'paid', 'processing', 'fulfilled', 'disputed', 'cancelled', 'failed')),
	CONSTRAINT "purchase_orders_total_chk" CHECK ("purchase_orders"."total_amount" = "purchase_orders"."subtotal" + "purchase_orders"."delivery_cost")
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_quote_reference" text,
	"subtotal" numeric(20, 6) NOT NULL,
	"delivery_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"additional_costs" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_cost" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"estimated_delivery_days" integer,
	"availability_status" text DEFAULT 'unknown' NOT NULL,
	"quote_status" text DEFAULT 'received' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_total_chk" CHECK ("quotations"."total_cost" = "quotations"."subtotal" + "quotations"."delivery_cost" + "quotations"."additional_costs")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "spending_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"max_total_spend" numeric(20, 6) NOT NULL,
	"max_transaction_amount" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"approval_required_above" numeric(20, 6),
	"approved_supplier_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restricted_supplier_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"restricted_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spending_policies_business_id_unique" UNIQUE("business_id"),
	CONSTRAINT "spending_policies_limits_chk" CHECK ("spending_policies"."max_transaction_amount" <= "spending_policies"."max_total_spend")
);
--> statement-breakpoint
CREATE TABLE "spending_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"passport_session_reference" text,
	"task_summary" text NOT NULL,
	"requested_amount" numeric(20, 6) NOT NULL,
	"max_amount_per_transaction" numeric(20, 6) NOT NULL,
	"max_total_amount" numeric(20, 6) NOT NULL,
	"asset" text NOT NULL,
	"approval_url" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spending_sessions_status_chk" CHECK ("spending_sessions"."status" in ('requested', 'awaiting_user_approval', 'active', 'exhausted', 'expired', 'revoked', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "supplier_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"source_url" text,
	"source_name" text NOT NULL,
	"evidence_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification_status" text DEFAULT 'unknown' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "supplier_evidence_type_chk" CHECK ("supplier_evidence"."evidence_type" in ('business_identity', 'contact_information', 'quotation', 'product_availability', 'delivery_history', 'payment_destination', 'transaction_history'))
);
--> statement-breakpoint
CREATE TABLE "supplier_payout_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"address" text NOT NULL,
	"network" text NOT NULL,
	"asset" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_destination_unique" UNIQUE("supplier_id","address","network")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"description" text,
	"website" text,
	"country_code" text,
	"city" text,
	"address" text,
	"email" text,
	"phone" text,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_status" text DEFAULT 'unknown' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_verification_chk" CHECK ("suppliers"."verification_status" in ('unknown', 'unverified', 'verified', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_stages" ADD CONSTRAINT "agent_task_stages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_stages" ADD CONSTRAINT "agent_task_stages_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_procurement_request_id_procurement_requests_id_fk" FOREIGN KEY ("procurement_request_id") REFERENCES "public"."procurement_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_spending_session_id_spending_sessions_id_fk" FOREIGN KEY ("spending_session_id") REFERENCES "public"."spending_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_request_id_procurement_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."procurement_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_procurement_item_id_procurement_items_id_fk" FOREIGN KEY ("procurement_item_id") REFERENCES "public"."procurement_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_request_id_procurement_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."procurement_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_request_id_procurement_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."procurement_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_policies" ADD CONSTRAINT "spending_policies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_sessions" ADD CONSTRAINT "spending_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_sessions" ADD CONSTRAINT "spending_sessions_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_evidence" ADD CONSTRAINT "supplier_evidence_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_evidence" ADD CONSTRAINT "supplier_evidence_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payout_destinations" ADD CONSTRAINT "supplier_payout_destinations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payout_destinations" ADD CONSTRAINT "supplier_payout_destinations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payout_destinations" ADD CONSTRAINT "supplier_payout_destinations_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_events_task_idx" ON "agent_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_tasks_business_idx" ON "agent_tasks" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "agent_tasks_request_idx" ON "agent_tasks" USING btree ("procurement_request_id");--> statement-breakpoint
CREATE INDEX "approvals_business_status_idx" ON "approvals" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "audit_logs_business_idx" ON "audit_logs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "business_members_user_idx" ON "business_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "payments_business_status_idx" ON "payments" USING btree ("business_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_live_per_po" ON "payments" USING btree ("purchase_order_id") WHERE "payments"."status" in ('prepared','awaiting_authorisation','authorised','submitted','pending','confirmed');--> statement-breakpoint
CREATE INDEX "procurement_items_request_idx" ON "procurement_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "procurement_requests_business_status_idx" ON "procurement_requests" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "purchase_order_items_po_idx" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_business_status_idx" ON "purchase_orders" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "quotations_request_idx" ON "quotations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "quotations_supplier_idx" ON "quotations" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spending_sessions_business_idx" ON "spending_sessions" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "supplier_evidence_supplier_idx" ON "supplier_evidence" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "payout_destination_supplier_idx" ON "supplier_payout_destinations" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "suppliers_business_idx" ON "suppliers" USING btree ("business_id");