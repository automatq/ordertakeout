ALTER TYPE "public"."notification_channel" ADD VALUE 'sms_customer' BEFORE 'discord';--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD COLUMN "sms_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_sms_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_sms_consent_at" timestamp with time zone;