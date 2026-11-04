ALTER TABLE "quotations" ADD COLUMN "line_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "unknown_costs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_external_unique" ON "suppliers" USING btree ("business_id","source_type","external_ref") WHERE "suppliers"."external_ref" is not null;