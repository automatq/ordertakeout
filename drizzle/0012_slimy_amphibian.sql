CREATE TABLE "product_availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"square_product_id" text NOT NULL,
	"square_location_id" text,
	"date" date NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_availability_overrides_key" ON "product_availability_overrides" USING btree ("square_product_id","square_location_id","date");--> statement-breakpoint
CREATE INDEX "product_availability_overrides_date_idx" ON "product_availability_overrides" USING btree ("date");