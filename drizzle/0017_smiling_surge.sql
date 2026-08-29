CREATE TABLE "phone_sign_in_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phone_sign_in_codes" ADD CONSTRAINT "phone_sign_in_codes_customer_account_id_customer_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_sign_in_codes_account_idx" ON "phone_sign_in_codes" USING btree ("customer_account_id");--> statement-breakpoint
CREATE INDEX "phone_sign_in_codes_expires_idx" ON "phone_sign_in_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customer_accounts_phone_idx" ON "customer_accounts" USING btree ("phone");