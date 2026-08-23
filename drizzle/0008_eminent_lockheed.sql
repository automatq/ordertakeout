CREATE TYPE "public"."pickup_verification_method" AS ENUM('qr', 'manual');--> statement-breakpoint
CREATE TABLE "pickup_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "pickup_verification_method" NOT NULL,
	"staff_initials" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickup_verifications" ADD CONSTRAINT "pickup_verifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_verifications_order_id_key" ON "pickup_verifications" USING btree ("order_id");