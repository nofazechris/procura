-- Custom migration: tenant isolation (RLS), append-only audit tables, payment integrity guards.
-- Technical PRD s5, s6.2, s12.11, s13.3, s18.

-- Context helpers. The app sets these per transaction via set_config(..., true) (see withTenant).
CREATE OR REPLACE FUNCTION app_business_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_business_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_user_id', true), '') $$;
--> statement-breakpoint

-- Row Level Security on every tenant table except business_members and businesses (handled below).
-- FORCE applies the policies to the table owner as well. Superusers and BYPASSRLS roles still
-- bypass RLS, so the application must connect as the non-owner role `procura_app` (docs/neon-setup.md).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'document_counters','procurement_requests','procurement_items','suppliers','supplier_evidence',
    'supplier_payout_destinations','quotations','purchase_orders','purchase_order_items',
    'spending_policies','approvals','spending_sessions','payments','agent_tasks','agent_task_stages',
    'agent_events','audit_logs','notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- business_members: a user can always read their own memberships (to discover which businesses
-- they belong to); every write must be inside the current business.
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY members_select ON business_members FOR SELECT
  USING (business_id = app_business_id() OR user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY members_write ON business_members FOR ALL
  USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
--> statement-breakpoint

-- businesses: visible to members; a new business may only be inserted under its own id, which the
-- app pre-generates and sets as the current business for that transaction.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY businesses_select ON businesses FOR SELECT
  USING (id = app_business_id() OR id IN (SELECT business_id FROM business_members WHERE user_id = app_user_id()));
--> statement-breakpoint
CREATE POLICY businesses_write ON businesses FOR ALL
  USING (id = app_business_id()) WITH CHECK (id = app_business_id());
--> statement-breakpoint

-- Append-only: audit_logs and agent_events can be inserted but never changed or removed.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_events_append_only BEFORE UPDATE OR DELETE ON agent_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- Payment integrity: only legal status transitions, and nothing payable may change once the
-- payment has been authorised. Mirrors packages/shared state-machines.ts as defence in depth.
CREATE OR REPLACE FUNCTION enforce_payment_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF old.status NOT IN ('prepared', 'awaiting_authorisation') AND (
       new.amount IS DISTINCT FROM old.amount
    OR new.recipient_address IS DISTINCT FROM old.recipient_address
    OR new.asset IS DISTINCT FROM old.asset
    OR new.network IS DISTINCT FROM old.network
    OR new.purchase_order_id IS DISTINCT FROM old.purchase_order_id
  ) THEN
    RAISE EXCEPTION 'Payment % is past authorisation: amount, recipient, asset and order are immutable', old.id;
  END IF;

  IF new.status = old.status THEN
    RETURN new;
  END IF;

  IF NOT (
       (old.status = 'prepared'               AND new.status IN ('awaiting_authorisation', 'cancelled'))
    OR (old.status = 'awaiting_authorisation' AND new.status IN ('authorised', 'cancelled', 'failed'))
    OR (old.status = 'authorised'             AND new.status IN ('submitted', 'cancelled', 'failed'))
    OR (old.status = 'submitted'              AND new.status IN ('pending', 'confirmed', 'failed'))
    OR (old.status = 'pending'                AND new.status IN ('confirmed', 'failed'))
  ) THEN
    RAISE EXCEPTION 'Invalid payment transition % -> %', old.status, new.status;
  END IF;
  RETURN new;
END $$;
--> statement-breakpoint
CREATE TRIGGER payments_integrity BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_integrity();
--> statement-breakpoint

-- Privileges for the application role, when it exists. Create it first (docs/neon-setup.md), then
-- run migrations. If the role is created later, re-run the GRANT block from the docs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procura_app') THEN
    GRANT USAGE ON SCHEMA public TO procura_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO procura_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO procura_app;
    REVOKE UPDATE, DELETE ON audit_logs, agent_events FROM procura_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO procura_app;
  END IF;
END $$;
