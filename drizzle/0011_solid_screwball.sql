CREATE TYPE "public"."order_refund_origin" AS ENUM('cancellation', 'staff', 'external');--> statement-breakpoint
ALTER TYPE "public"."loyalty_entry_kind" ADD VALUE 'revoked';--> statement-breakpoint
ALTER TYPE "public"."refund_status" ADD VALUE 'partial';--> statement-breakpoint
CREATE TABLE "order_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"square_refund_id" text,
	"attempt_key" text,
	"origin" "order_refund_origin" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "refund_status" NOT NULL,
	"reason" text,
	"initiated_by" text,
	"error" text,
	"attempt_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "order_refunds_amount_positive" CHECK ("order_refunds"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_total_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_pending_key" ON "order_refunds" USING btree ("order_id") WHERE "order_refunds"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_square_id_key" ON "order_refunds" USING btree ("square_refund_id") WHERE "order_refunds"."square_refund_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_attempt_key" ON "order_refunds" USING btree ("attempt_key") WHERE "order_refunds"."attempt_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_refunds_order_idx" ON "order_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_refunds_completed_idx" ON "order_refunds" USING btree ("completed_at");--> statement-breakpoint
INSERT INTO "order_refunds" ("order_id", "square_refund_id", "attempt_key", "origin", "amount_cents", "currency", "status", "completed_at", "created_at", "updated_at")
SELECT "id", "square_refund_id", "refund_attempt_key", 'cancellation', "total_cents", "currency", 'completed', COALESCE("canceled_at", "updated_at"), COALESCE("canceled_at", "updated_at"), COALESCE("canceled_at", "updated_at")
FROM "orders" WHERE "refund_status" = 'completed' AND "total_cents" > 0;--> statement-breakpoint
UPDATE "orders" SET "refunded_total_cents" = "total_cents" WHERE "refund_status" = 'completed';
