CREATE TABLE "business_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"linked_by" text NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_wallets_status_chk" CHECK ("business_wallets"."status" in ('active', 'revoked')),
	CONSTRAINT "business_wallets_address_chk" CHECK ("business_wallets"."address" ~ '^0x[0-9a-f]{40}$'),
	CONSTRAINT "business_wallets_revoked_chk" CHECK (("business_wallets"."status" = 'active') or ("business_wallets"."revoked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "business_wallets" ADD CONSTRAINT "business_wallets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_wallets" ADD CONSTRAINT "business_wallets_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_wallets" ADD CONSTRAINT "business_wallets_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_wallets_active_uq" ON "business_wallets" USING btree ("business_id","address","chain_id") WHERE "business_wallets"."status" = 'active';--> statement-breakpoint
CREATE INDEX "business_wallets_business_idx" ON "business_wallets" USING btree ("business_id","status");--> statement-breakpoint

-- Tenant isolation, like every other tenant table.
ALTER TABLE business_wallets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_wallets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON business_wallets
  USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
--> statement-breakpoint

-- A linked wallet is a proof of control at one moment, so its identity can never be edited:
-- only status (revocation) and label may change. The app role cannot delete rows (see the grants
-- below), so history survives.
CREATE OR REPLACE FUNCTION business_wallets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id <> OLD.business_id OR NEW.address <> OLD.address OR NEW.chain_id <> OLD.chain_id
     OR NEW.linked_by <> OLD.linked_by OR NEW.linked_at <> OLD.linked_at THEN
    RAISE EXCEPTION 'a linked wallet''s address, chain and owner cannot be changed';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'a revoked wallet cannot be re-activated; link it again';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_wallets_guard BEFORE UPDATE ON business_wallets
  FOR EACH ROW EXECUTE FUNCTION business_wallets_guard();
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procura_app') THEN
    GRANT SELECT, INSERT, UPDATE ON business_wallets TO procura_app;
    REVOKE DELETE ON business_wallets FROM procura_app;
  END IF;
END $$;
