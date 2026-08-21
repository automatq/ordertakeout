ALTER TABLE "orders" ADD COLUMN "payment_attempt_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_attempt_source_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_attempt_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_attempt_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_attempt_started_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_square_payment_id_key" ON "orders" USING btree ("square_payment_id");--> statement-breakpoint

-- The previous release stored the order UUID itself as both the PROCESSING
-- marker suffix and Square idempotency key. Preserve that exact key across a
-- rolling deploy so an in-flight retry cannot create a second payment.
UPDATE "orders"
SET "payment_attempt_key" = "id"::text,
    "payment_attempt_started_at" = "updated_at"
WHERE "status" = 'pending_payment'
  AND "square_payment_id" = 'PROCESSING:' || "id"::text;--> statement-breakpoint

-- Existing cancellation code used this exact deterministic key. Persist it so
-- a rolling-deploy retry asks Square about the original refund attempt.
UPDATE "orders"
SET "refund_attempt_key" = 'cancel-' || "id"::text,
    "refund_attempt_started_at" = "updated_at"
WHERE "refund_status" = 'pending'
  AND "refund_attempt_key" IS NULL;--> statement-breakpoint

-- Old checkout deadlines must not elapse between migrating the attempt state
-- and deploying the code that reconciles it. Terminal payment/cancellation
-- paths remove or restore these payment-bound reservations.
UPDATE "slot_holds" AS "hold"
SET "expires_at" = '9999-12-31 23:59:59.999+00'
FROM "orders" AS "order"
WHERE "hold"."order_id" = "order"."id"
  AND "order"."payment_attempt_key" IS NOT NULL;--> statement-breakpoint

UPDATE "inventory_holds" AS "hold"
SET "expires_at" = '9999-12-31 23:59:59.999+00',
    "updated_at" = now()
FROM "orders" AS "order"
WHERE "hold"."order_id" = "order"."id"
  AND "order"."payment_attempt_key" IS NOT NULL;
