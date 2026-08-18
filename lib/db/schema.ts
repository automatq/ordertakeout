import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
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
    pickupDate: date("pickup_date").notNull(),
    pickupTime: time("pickup_time").notNull(),
    maxOrders: integer("max_orders").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("slot_capacity_date_time_key").on(t.pickupDate, t.pickupTime)],
);

/** Holidays and closures. Presence of a row blocks all pickups that day. */
export const blackoutDates = pgTable("blackout_dates", {
  date: date("date").primaryKey(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    squareRefundId: text("square_refund_id"),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),

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
    // The dashboard's main query: "everything for this pickup day, by slot".
    index("orders_pickup_idx").on(t.pickupDate, t.pickupTime),
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
    pickupDate: date("pickup_date").notNull(),
    pickupTime: time("pickup_time").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("slot_holds_slot_idx").on(t.pickupDate, t.pickupTime),
    index("slot_holds_expires_at_idx").on(t.expiresAt),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_log_order_id_idx").on(t.orderId)],
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
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const slotHoldsRelations = relations(slotHolds, ({ one }) => ({
  order: one(orders, { fields: [slotHolds.orderId], references: [orders.id] }),
}));

export const notificationLogRelations = relations(notificationLog, ({ one }) => ({
  order: one(orders, { fields: [notificationLog.orderId], references: [orders.id] }),
}));

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type ProductConfig = typeof productsConfig.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
