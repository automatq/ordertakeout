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
  /** ≥1 completed refund for less than the order total, nothing in flight. */
  "partial",
]);

/** Where a refund originated: our cancellation flow, a staff refund, or Square-side directly. */
export const orderRefundOrigin = pgEnum("order_refund_origin", [
  "cancellation",
  "staff",
  "external",
]);

/** How staff established that an order was collected at the counter. */
export const pickupVerificationMethod = pgEnum("pickup_verification_method", [
  "qr",
  "manual",
]);

/** A ledger is used instead of a mutable points balance so every change is explainable. */
export const loyaltyEntryKind = pgEnum("loyalty_entry_kind", [
  "earned",
  "redeemed",
  "reversed",
  /** Earned points clawed back when a completed pickup is later fully refunded. */
  "revoked",
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

/**
 * Optional, passwordless customer identity. Guest ordering remains supported;
 * this record is created only from a signed order-confirmation page.
 */
export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Always normalized to lowercase before persistence. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_accounts_email_key").on(t.email)],
);

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
    /** Sum of completed refunds (order_refunds ledger); maintained inside the same transactions. */
    refundedTotalCents: integer("refunded_total_cents").notNull().default(0),
    squareSyncError: text("square_sync_error"),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerAccountId: uuid("customer_account_id").references(() => customerAccounts.id, {
      onDelete: "set null",
    }),
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
    /** Dormant: no writer or reader yet (the anonymizer only nulls it). Kept for the planned staff order-notes feature. */
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
 * Immutable counter record for an order collection.
 *
 * An order can only be collected once, so this is deliberately a one-to-one
 * row rather than a mutable field on `orders`. It preserves the proof used at
 * the counter independently from the order's lifecycle timestamps.
 */
export const pickupVerifications = pgTable(
  "pickup_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    method: pickupVerificationMethod("method").notNull(),
    /** Operational attribution while staff authentication remains shared. */
    staffInitials: text("staff_initials").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pickup_verifications_order_id_key").on(t.orderId)],
);

/** One immutable entry per order action; points are never edited in place. */
export const loyaltyEntries = pgTable(
  "loyalty_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerAccountId: uuid("customer_account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: loyaltyEntryKind("kind").notNull(),
    /** Positive for earned/reversed points and negative for redemptions. */
    points: integer("points").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("loyalty_entries_order_kind_key").on(t.orderId, t.kind),
    index("loyalty_entries_account_created_idx").on(t.customerAccountId, t.createdAt),
  ],
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

/**
 * One row per logical refund — the money history the orders row can't hold.
 *
 * The `orders.refund_*` columns remain the coarse per-order lock (one refund in
 * flight, attempt-lease semantics); this table records every refund — the
 * cancellation flow's, staff partial/post-pickup refunds, and refunds issued
 * directly in Square — so "how much has been returned on this order, when, by
 * whom, and why" is answerable. The partial unique index makes "one in-flight
 * refund per order" a database guarantee rather than an application promise.
 */
export const orderRefunds = pgTable(
  "order_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Null until Square answers; also null forever for rows we never initiated. */
    squareRefundId: text("square_refund_id"),
    /** Our idempotency key for the attempt; null for Square-initiated (external) rows. */
    attemptKey: text("attempt_key"),
    origin: orderRefundOrigin("origin").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    /** Only pending | completed | failed are used at row level. */
    status: refundStatus("status").notNull(),
    reason: text("reason"),
    /** Roster initials for staff refunds. */
    initiatedBy: text("initiated_by"),
    error: text("error"),
    attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("order_refunds_pending_key").on(t.orderId).where(sql`${t.status} = 'pending'`),
    uniqueIndex("order_refunds_square_id_key").on(t.squareRefundId).where(sql`${t.squareRefundId} IS NOT NULL`),
    uniqueIndex("order_refunds_attempt_key").on(t.attemptKey).where(sql`${t.attemptKey} IS NOT NULL`),
    index("order_refunds_order_idx").on(t.orderId),
    index("order_refunds_completed_idx").on(t.completedAt),
    check("order_refunds_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

/**
 * The staff roster: attribution, not authentication.
 *
 * The dashboard stays behind one shared password; these rows exist so the
 * initials typed at pickup verification, refunds, and settings changes resolve
 * to a real person. Members are deactivated rather than deleted so historical
 * attribution keeps meaning. `initials` are stored uppercased (normalized in
 * lib/staff/roster.ts) — the unique index depends on it.
 */
export const staffMembers = pgTable(
  "staff_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    initials: text("initials").notNull(),
    /** Optional 4-digit PIN (HMAC, lib/staff/roster.ts) required for refunds only. Attribution hardening, not security. */
    pinHash: text("pin_hash"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("staff_members_initials_key").on(t.initials)],
);

/**
 * Append-only record of operator-relevant actions: status changes, refunds,
 * cancellations, 86ing, pause toggles, settings writes. No update or delete
 * path exists in code. `metadata` must never contain customer PII — the
 * retention anonymizer does not touch this table.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "staff" | "system:webhook" | "system:cron" | "customer" */
    actorType: text("actor_type").notNull(),
    actorInitials: text("actor_initials"),
    /** Dotted verb slug, e.g. "order.status_changed", "order.refunded", "product.86ed". */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** Kept nullable so audit history survives order deletion. */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_order_idx").on(t.orderId),
    index("audit_log_action_idx").on(t.action),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customerAccount: one(customerAccounts, {
    fields: [orders.customerAccountId],
    references: [customerAccounts.id],
  }),
  items: many(orderItems),
  pickupVerifications: many(pickupVerifications),
  notifications: many(notificationLog),
  holds: many(slotHolds),
  inventoryHolds: many(inventoryHolds),
  loyaltyEntries: many(loyaltyEntries),
}));

export const customerAccountsRelations = relations(customerAccounts, ({ many }) => ({
  orders: many(orders),
  loyaltyEntries: many(loyaltyEntries),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const pickupVerificationsRelations = relations(pickupVerifications, ({ one }) => ({
  order: one(orders, { fields: [pickupVerifications.orderId], references: [orders.id] }),
}));

export const loyaltyEntriesRelations = relations(loyaltyEntries, ({ one }) => ({
  customerAccount: one(customerAccounts, {
    fields: [loyaltyEntries.customerAccountId],
    references: [customerAccounts.id],
  }),
  order: one(orders, { fields: [loyaltyEntries.orderId], references: [orders.id] }),
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
export type PickupVerification = typeof pickupVerifications.$inferSelect;
export type CustomerAccount = typeof customerAccounts.$inferSelect;
export type LoyaltyEntry = typeof loyaltyEntries.$inferSelect;
export type InventoryHold = typeof inventoryHolds.$inferSelect;
export type ProductConfig = typeof productsConfig.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
