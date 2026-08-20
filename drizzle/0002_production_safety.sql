CREATE TYPE "public"."refund_status" AS ENUM('not_required', 'pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"identifier_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "slot_capacity_date_time_key";--> statement-breakpoint
ALTER TABLE "blackout_dates" DROP CONSTRAINT "blackout_dates_pkey";--> statement-breakpoint
ALTER TABLE "blackout_dates" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "blackout_dates" ADD COLUMN "square_location_id" text;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
UPDATE "notification_log" SET "next_attempt_at" = now() WHERE "status" = 'failed';--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "square_product_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_status" "refund_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_error" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_location_phone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_location_timezone" text;--> statement-breakpoint
ALTER TABLE "slot_capacity" ADD COLUMN "square_location_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_scope_identifier_key" ON "rate_limits" USING btree ("scope","identifier_hash");--> statement-breakpoint
CREATE INDEX "rate_limits_updated_at_idx" ON "rate_limits" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blackout_dates_location_date_key" ON "blackout_dates" USING btree ("square_location_id","date");--> statement-breakpoint
CREATE INDEX "notification_log_retry_idx" ON "notification_log" USING btree ("status","next_attempt_at");--> statement-breakpoint
DELETE FROM "notification_log"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "order_id", "event", "channel"
      ORDER BY ("status" = 'sent') DESC, "created_at" ASC
    ) AS duplicate_number
    FROM "notification_log"
  ) deliveries
  WHERE duplicate_number > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_delivery_key" ON "notification_log" USING btree ("order_id","event","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_capacity_location_date_time_key" ON "slot_capacity" USING btree ("square_location_id","pickup_date","pickup_time");
