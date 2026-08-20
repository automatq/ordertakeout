ALTER TABLE "orders" ADD COLUMN "square_location_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_location_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_location_address" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_location_city" text;--> statement-breakpoint
ALTER TABLE "slot_holds" ADD COLUMN "square_location_id" text;--> statement-breakpoint
DROP INDEX "orders_pickup_idx";--> statement-breakpoint
CREATE INDEX "orders_pickup_idx" ON "orders" USING btree ("square_location_id","pickup_date","pickup_time");--> statement-breakpoint
DROP INDEX "slot_holds_slot_idx";--> statement-breakpoint
CREATE INDEX "slot_holds_slot_idx" ON "slot_holds" USING btree ("square_location_id","pickup_date","pickup_time");
