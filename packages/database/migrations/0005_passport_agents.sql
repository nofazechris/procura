CREATE TABLE "passport_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_type" text NOT NULL,
	"passport_agent_id" text NOT NULL,
	"passport_owner_id" text NOT NULL,
	"registered_by" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passport_agents_business_agent_uq" UNIQUE("business_id","passport_agent_id")
);
--> statement-breakpoint
ALTER TABLE "spending_sessions" ADD COLUMN "passport_request_id" text;--> statement-breakpoint
ALTER TABLE "passport_agents" ADD CONSTRAINT "passport_agents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passport_agents" ADD CONSTRAINT "passport_agents_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passport_agents_business_idx" ON "passport_agents" USING btree ("business_id");--> statement-breakpoint

-- Tenant isolation, like every other tenant table.
ALTER TABLE passport_agents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE passport_agents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON passport_agents
  USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
--> statement-breakpoint

-- An agent identity is a record of what Passport issued. The app can add and read it but never
-- rewrite or delete it, so the audit trail of "which agent acted" cannot be altered.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'procura_app') THEN
    GRANT SELECT, INSERT ON passport_agents TO procura_app;
    REVOKE UPDATE, DELETE ON passport_agents FROM procura_app;
  END IF;
END $$;
