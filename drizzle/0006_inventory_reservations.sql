CREATE TABLE "inventory_holds" (
	"order_id" uuid NOT NULL,
	"square_variation_id" text NOT NULL,
	"square_location_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_holds_order_variation_pk" PRIMARY KEY("order_id","square_variation_id"),
	CONSTRAINT "inventory_holds_quantity_positive" CHECK ("inventory_holds"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_holds_location_variation_expiry_idx" ON "inventory_holds" USING btree ("square_location_id","square_variation_id","expires_at");--> statement-breakpoint
CREATE INDEX "inventory_holds_expires_at_idx" ON "inventory_holds" USING btree ("expires_at");
