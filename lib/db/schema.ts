import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------------------
 * Conventions
 *
 * - Money is stored as INTEGER CENTS everywhere. No floats, no numerics. The
 *   Square SDK hands us `bigint` cents; lib/square/client.ts converts at the
 *   boundary.
 * - Dates and times are stored as bare `date` / `time` (no timezone) because
 *   they are *wall-clock times at the store* — "pick up at 4 PM" means 4 PM in
 *   the shop regardless of DST. Instants (created_at, paid_at) are timestamptz.
 * - Product identity is the Square catalog object ID. Square owns items and
 *   prices; this database owns everything Square can't express.
 * ------------------------------------------------------------------------- */

export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "preparing",
  "ready",
  "completed",
  "canceled",
]);

export const notificationChannel = pgEnum("notification_channel", [
  "email",
  "email_store",
  "email_customer",
  "sms",
  "discord",
  "slack",
  "trello",
  "webhook",
]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
]);

export const refundStatus = pgEnum("refund_status", [
  "not_required",
  "pending",
  "completed",
  "failed",
]);

/* -------------------------------------------------------------------------- */
/* Catalog overlay                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Per-product ordering rules, keyed by Square catalog object ID.
 *
 * Square is the source of truth for name, price and image; this table carries
 * the things Square has no concept of. Every rule here is per-product because
 * Ensaymada (1 day ahead, 6 PM cutoff) and the other trays have different
 * requirements, and the store has not confirmed the Hopia / Ube Bar rules yet.
 */
export const productsConfig = pgTable(
  "products_config",
  {
    squareCatalogObjectId: text("square_catalog_object_id").primaryKey(),
    slug: text("slug").notNull(),

    /** Minimum days between ordering and pickup. Ensaymada = 1. */
    leadTimeDays: integer("lead_time_days").notNull().default(1),
    /** Daily order deadline in store-local time. Ensaymada = 18:00. */
    orderCutoffTime: time("order_cutoff_time").notNull().default("18:00"),
    /** Explicit pickup times offered, store-local. Ensaymada = 16:00 … 20:00. */
    allowedPickupTimes: time("allowed_pickup_times").array().notNull(),

    /** Production ceiling per day for this product. Null = unlimited. */
    maxUnitsPerDay: integer("max_units_per_day"),
    /** Staff kill-switch to pull a product without deleting it from Square. */
    isOrderable: boolean("is_orderable").notNull().default(true),

    sortOrder: integer("sort_order").notNull().default(0),
    /** Optional overrides for when Square's own image/description aren't enough. */
    heroImageUrl: text("hero_image_url"),
    descriptionMd: text("description_md"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_config_slug_key").on(t.slug)],
);

/* -------------------------------------------------------------------------- */
/* Capacity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Staff override for how many orders a single pickup slot can hold.
 * A missing row means "use the configured default", not "zero".
 */
export const slotCapacity = pgTable(
  "slot_capacity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null only on legacy rows created before multi-location support. */
    squareLocationId: text("square_location_id"),
    pickupDate: date("pickup_date").notNull(),
    pickupTime: time("pickup_time").notNull(),
    maxOrders: integer("max_orders").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("slot_capacity_location_date_time_key").on(
      t.squareLocationId,
      t.pickupDate,
      t.pickupTime,
    ),
  ],
);

/** Holidays and closures, independently configurable for each branch. */
export const blackoutDates = pgTable(
  "blackout_dates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null only on legacy rows, which continue to apply to every branch. */
    squareLocationId: text("square_location_id"),
    date: date("date").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("blackout_dates_location_date_key").on(t.squareLocationId, t.date),
  ],
);

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short human-readable reference the customer quotes at the counter. */
    orderNumber: text("order_number").notNull(),

    squareOrderId: text("square_order_id"),
    squarePaymentId: text("square_payment_id"),
    /** Durable key for the current Square payment attempt; rotated after a definitive failure. */
    paymentAttemptKey: text("payment_attempt_key"),
    /** Opaque Square token retained only so an ambiguous retry can replay the exact request. */
    paymentAttemptSourceId: text("payment_attempt_source_id"),
    /** Lease timestamp for exclusive ownership of the current payment attempt. */
    paymentAttemptStartedAt: timestamp("payment_attempt_started_at", { withTimezone: true }),
    squareRefundId: text("square_refund_id"),
    /** Durable key for the current Square refund attempt; rotated after a definitive failure. */
    refundAttemptKey: text("refund_attempt_key"),
    /** Lease timestamp for exclusive ownership of the current refund attempt. */
    refundAttemptStartedAt: timestamp("refund_attempt_started_at", { withTimezone: true }),
    refundStatus: refundStatus("refund_status").notNull().default("not_required"),
    refundError: text("refund_error"),
    squareSyncError: text("square_sync_error"),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    /** Square location chosen at checkout; never inferred later from the current store list. */
    squareLocationId: text("square_location_id"),
    pickupLocationName: text("pickup_location_name"),
    pickupLocationAddress: text("pickup_location_address"),
    pickupLocationCity: text("pickup_location_city"),
    pickupLocationPhone: text("pickup_location_phone"),
    pickupLocationTimezone: text("pickup_location_timezone"),
    pickupLocationHours: jsonb("pickup_location_hours").$type<
      { dayOfWeek: string; startTime: string; endTime: string }[]
    >(),

    /** Wall-clock at the store — see conventions above. */
    pickupDate: date("pickup_date").notNull(),
    pickupTime: time("pickup_time").notNull(),

    status: orderStatus("status").notNull().default("pending_payment"),

    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("USD"),

    customerNote: text("customer_note"),
    staffNote: text("staff_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("orders_order_number_key").on(t.orderNumber),
    uniqueIndex("orders_square_order_id_key").on(t.squareOrderId),
    uniqueIndex("orders_square_payment_id_key").on(t.squarePaymentId),
    // The dashboard's main query: "everything for this pickup day, by slot".
    index("orders_pickup_idx").on(t.squareLocationId, t.pickupDate, t.pickupTime),
    index("orders_status_idx").on(t.status),
  ],
);

/**
 * Line items snapshot name and price at time of purchase, so a later price
 * change in Square Catalog never rewrites the history of a completed order.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    squareCatalogObjectId: text("square_catalog_object_id").notNull(),
    /** Parent Square ITEM id, used for product-level production limits. */
    squareProductId: text("square_product_id"),
    nameSnapshot: text("name_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalPriceCents: integer("total_price_cents").notNull(),
  },
  (t) => [index("order_items_order_id_idx").on(t.orderId)],
);

/**
 * Short-lived claim on a pickup slot, taken *before* charging the card.
 *
 * Without this, two customers checking out simultaneously both read "1 space
 * left" and both succeed — the classic check-then-act race. Claiming a row
 * inside a transaction that locks the slot makes overbooking impossible rather
 * than merely unlikely. Expired holds are swept by a background job.
 */
export const slotHolds = pgTable(
  "slot_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squareLocationId: text("square_location_id"),
    pickupDate: date("pickup_date").notNull(),
    pickupTime: time("pickup_time").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("slot_holds_slot_idx").on(t.squareLocationId, t.pickupDate, t.pickupTime),
    index("slot_holds_expires_at_idx").on(t.expiresAt),
  ],
);

/**
 * Short-lived claims on Square inventory while an online order is being paid.
 *
 * Square remains the raw inventory authority. These rows only represent units
 * already promised to another checkout but not necessarily reflected in
 * Square's count yet. The composite key makes a retry for the same order and
 * variation idempotent, while location is part of every availability query.
 */
export const inventoryHolds = pgTable(
  "inventory_holds",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    squareVariationId: text("square_variation_id").notNull(),
    squareLocationId: text("square_location_id").notNull(),
    quantity: integer("quantity").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.orderId, t.squareVariationId],
      name: "inventory_holds_order_variation_pk",
    }),
    check("inventory_holds_quantity_positive", sql`${t.quantity} > 0`),
    index("inventory_holds_location_variation_expiry_idx").on(
      t.squareLocationId,
      t.squareVariationId,
      t.expiresAt,
    ),
    index("inventory_holds_expires_at_idx").on(t.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Notifications & webhooks                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One row per delivery attempt per channel. Exists so that "the store says they
 * never got the text" is an answerable question rather than a guess.
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    channel: notificationChannel("channel").notNull(),
    event: text("event").notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    payload: jsonb("payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_log_order_id_idx").on(t.orderId),
    index("notification_log_retry_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("notification_log_delivery_key").on(t.orderId, t.event, t.channel),
  ],
);

/** Durable, shared throttling for public actions and staff sign-in. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    identifierHash: text("identifier_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rate_limits_scope_identifier_key").on(t.scope, t.identifierHash),
    index("rate_limits_updated_at_idx").on(t.updatedAt),
  ],
);

/**
 * Square retries webhooks and can deliver the same event more than once. The
 * primary key on Square's own event ID makes replay handling idempotent: insert
 * first, and if it conflicts we've already processed it.
 */
export const webhookEvents = pgTable("webhook_events", {
  squareEventId: text("square_event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  body: jsonb("body").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

/** Staff-editable settings that shouldn't require a redeploy (webhook URLs, default caps). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
  notifications: many(notificationLog),
  holds: many(slotHolds),
  inventoryHolds: many(inventoryHolds),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const slotHoldsRelations = relations(slotHolds, ({ one }) => ({
  order: one(orders, { fields: [slotHolds.orderId], references: [orders.id] }),
}));

export const inventoryHoldsRelations = relations(inventoryHolds, ({ one }) => ({
  order: one(orders, { fields: [inventoryHolds.orderId], references: [orders.id] }),
}));

export const notificationLogRelations = relations(notificationLog, ({ one }) => ({
  order: one(orders, { fields: [notificationLog.orderId], references: [orders.id] }),
}));

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type InventoryHold = typeof inventoryHolds.$inferSelect;
export type ProductConfig = typeof productsConfig.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
