ALTER TABLE "phone_sign_in_codes" ALTER COLUMN "customer_account_id" DROP NOT NULL;--> statement-breakpoint
--> Added nullable, backfilled, then constrained. A bare `ADD COLUMN ... NOT NULL`
--> aborts the moment one live code exists, and codes live for ten minutes.
ALTER TABLE "phone_sign_in_codes" ADD COLUMN "phone" text;--> statement-breakpoint
UPDATE "phone_sign_in_codes" AS c
  SET "phone" = a."phone"
  FROM "customer_accounts" AS a
  WHERE c."customer_account_id" = a."id" AND c."phone" IS NULL;--> statement-breakpoint
--> Before this migration the account was mandatory, so every row backfills.
--> Anything left has no subject to text and is unredeemable by construction.
DELETE FROM "phone_sign_in_codes" WHERE "phone" IS NULL;--> statement-breakpoint
ALTER TABLE "phone_sign_in_codes" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "phone_sign_in_codes_phone_idx" ON "phone_sign_in_codes" USING btree ("phone");
