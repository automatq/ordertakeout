CREATE TYPE "public"."loyalty_entry_kind" AS ENUM('earned', 'redeemed', 'reversed');--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "loyalty_entry_kind" NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_account_id" uuid;--> statement-breakpoint
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_customer_account_id_customer_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_entries_order_kind_key" ON "loyalty_entries" USING btree ("order_id","kind");--> statement-breakpoint
CREATE INDEX "loyalty_entries_account_created_idx" ON "loyalty_entries" USING btree ("customer_account_id","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_account_id_customer_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE set null ON UPDATE no action;