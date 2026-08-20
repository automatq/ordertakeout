ALTER TYPE "public"."notification_channel" ADD VALUE 'email_store' BEFORE 'sms';--> statement-breakpoint
ALTER TYPE "public"."notification_channel" ADD VALUE 'email_customer' BEFORE 'sms';