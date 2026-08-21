/**
 * One-time post-migration backfill for orders created before multi-location
 * checkout. Run with `npm run db:backfill-legacy-location` after setting the
 * four environment variables shown by `--help`.
 *
 * This is intentionally a plain Node entrypoint. Do not import application
 * modules guarded by `server-only` or functions that use Next.js cache APIs:
 * those boundaries require the Next runtime and make an operational CLI crash
 * before it can touch the database.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  CatalogObjectType,
  SquareClient,
  SquareEnvironment,
  type CatalogObject,
} from "square";

import * as schema from "../lib/db/schema";
import { findActiveSquareLocation } from "../lib/locations/square";
import type { StoreLocation } from "../lib/locations/types";

const BACKFILL_LOCK_KEY = "harina:legacy-location-backfill:v1";

const HELP = `Backfill pre-multi-location rows with one active Square location.

Required environment variables:
  DATABASE_URL
  SQUARE_ACCESS_TOKEN
  NEXT_PUBLIC_SQUARE_ENVIRONMENT  (sandbox or production)
  LEGACY_SQUARE_LOCATION_ID

Values are read from the process environment and an optional .env.local file.
The command validates the location against Square before opening a transaction.
All database changes commit together or roll back together.

Pass --strict to abort if a currently operational legacy order references a
Square variation that no longer has a catalog parent. Without --strict those
historical records are preserved and reported for manual cancellation.`;

export interface LegacyBackfillConfig {
  databaseUrl: string;
  squareAccessToken: string;
  squareEnvironment: "sandbox" | "production";
  legacyLocationId: string;
}

export interface LegacyBackfillSummary {
  orders: number;
  holds: number;
  blackouts: number;
  duplicateBlackouts: number;
  slotLimits: number;
  duplicateSlotLimits: number;
  lineItems: number;
  /** Historical records retained for audit even when Square purged their variation. */
  unresolvedLineItems: number;
  /** An unresolved item on an order that can still affect operations. */
  blockingUnresolvedLineItems: number;
}

export interface LegacyBackfillOperations {
  backfillOrders(): Promise<number>;
  backfillHolds(): Promise<number>;
  backfillBlackouts(): Promise<{ updated: number; discarded: number }>;
  backfillSlotLimits(): Promise<{ updated: number; discarded: number }>;
  backfillLineItems(): Promise<{
    updated: number;
    unresolved: number;
    blockingUnresolved: number;
  }>;
}

/** A narrow seam that lets transaction behavior be tested without Postgres. */
export interface LegacyBackfillRepository {
  transaction(
    work: (operations: LegacyBackfillOperations) => Promise<LegacyBackfillSummary>,
  ): Promise<LegacyBackfillSummary>;
}

export class UnresolvedLegacyLineItemsError extends Error {
  constructor(count: number) {
    super(
      `${count} legacy line items remain without a Square parent item; refusing to commit a partial backfill.`,
    );
    this.name = "UnresolvedLegacyLineItemsError";
  }
}

type BackfillEnvironment = Readonly<Record<string, string | undefined>>;

function loadLocalEnvironment(projectDirectory = process.cwd()): void {
  const environmentFile = resolve(projectDirectory, ".env.local");
  if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
}

function requiredEnv(env: BackfillEnvironment, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

export function readLegacyBackfillConfig(
  env: BackfillEnvironment = process.env,
): LegacyBackfillConfig {
  const squareEnvironment = requiredEnv(env, "NEXT_PUBLIC_SQUARE_ENVIRONMENT");
  if (squareEnvironment !== "sandbox" && squareEnvironment !== "production") {
    throw new Error("NEXT_PUBLIC_SQUARE_ENVIRONMENT must be sandbox or production.");
  }

  return {
    databaseUrl: requiredEnv(env, "DATABASE_URL"),
    squareAccessToken: requiredEnv(env, "SQUARE_ACCESS_TOKEN"),
    squareEnvironment,
    legacyLocationId: requiredEnv(env, "LEGACY_SQUARE_LOCATION_ID"),
  };
}

/**
 * Build the historical variation-to-item relation directly from Square.
 * Pricing and current orderability are irrelevant to this data repair.
 */
export function mapVariationProductIds(
  objects: readonly CatalogObject[],
): Map<string, string> {
  const result = new Map<string, string>();

  for (const object of objects) {
    if (object.type === "ITEM" && object.id) {
      for (const variation of object.itemData?.variations ?? []) {
        if (variation.type === "ITEM_VARIATION" && variation.id) {
          result.set(variation.id, object.id);
        }
      }
      continue;
    }

    if (
      object.type === "ITEM_VARIATION" &&
      object.id &&
      object.itemVariationData?.itemId
    ) {
      result.set(object.id, object.itemVariationData.itemId);
    }
  }

  return result;
}

/**
 * Prefer an explicitly location-scoped record when it collides with a legacy
 * null-location record. Among duplicate legacy rows, the caller orders the
 * preferred row first and the rest are discarded.
 */
export function planScopedLegacyRows<T extends { id: string }>(
  legacyRows: readonly T[],
  scopedRows: readonly T[],
  keyOf: (row: T) => string,
): { updateIds: string[]; discardIds: string[] } {
  const occupiedKeys = new Set(scopedRows.map(keyOf));
  const updateIds: string[] = [];
  const discardIds: string[] = [];

  for (const row of legacyRows) {
    const key = keyOf(row);
    if (occupiedKeys.has(key)) {
      discardIds.push(row.id);
      continue;
    }

    occupiedKeys.add(key);
    updateIds.push(row.id);
  }

  return { updateIds, discardIds };
}

/** Every write is deliberately invoked within the repository's transaction. */
export function executeLegacyBackfill(
  repository: LegacyBackfillRepository,
  options: { requireResolvedLineItems?: boolean } = {},
): Promise<LegacyBackfillSummary> {
  return repository.transaction(async (operations) => {
    const orders = await operations.backfillOrders();
    const holds = await operations.backfillHolds();
    const blackouts = await operations.backfillBlackouts();
    const slotLimits = await operations.backfillSlotLimits();
    const lineItems = await operations.backfillLineItems();

    const summary = {
      orders,
      holds,
      blackouts: blackouts.updated,
      duplicateBlackouts: blackouts.discarded,
      slotLimits: slotLimits.updated,
      duplicateSlotLimits: slotLimits.discarded,
      lineItems: lineItems.updated,
      unresolvedLineItems: lineItems.unresolved,
      blockingUnresolvedLineItems: lineItems.blockingUnresolved,
    };
    if (options.requireResolvedLineItems && summary.blockingUnresolvedLineItems) {
      // Throw inside the repository transaction, before it commits any of the
      // location writes. A warning after commit would leave production half
      // migrated and the application unable to decide whether it is safe.
      throw new UnresolvedLegacyLineItemsError(summary.blockingUnresolvedLineItems);
    }
    return summary;
  });
}

async function loadLegacyLocation(
  client: SquareClient,
  locationId: string,
): Promise<StoreLocation> {
  const response = await client.locations.list();
  const location = findActiveSquareLocation(response.locations ?? [], locationId);

  if (!location) {
    throw new Error("LEGACY_SQUARE_LOCATION_ID does not identify an active Square location.");
  }

  return location;
}

export async function loadVariationProductIds(
  client: Pick<SquareClient, "catalog">,
): Promise<Map<string, string>> {
  const objects: CatalogObject[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.catalog.search({
      objectTypes: [CatalogObjectType.Item, CatalogObjectType.ItemVariation],
      includeDeletedObjects: true,
      limit: 1_000,
      ...(cursor ? { cursor } : {}),
    });
    objects.push(...(response.objects ?? []));
    cursor = response.cursor ?? undefined;
  } while (cursor);

  return mapVariationProductIds(objects);
}

function createDrizzleRepository(
  database: ReturnType<typeof drizzle<typeof schema>>,
  location: StoreLocation,
  productByVariation: ReadonlyMap<string, string>,
): LegacyBackfillRepository {
  return {
    transaction: (work) =>
      database.transaction(
        async (tx) => {
          // Serializes repeated invocations. The transaction itself protects
          // against partial backfills if any later statement fails.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${BACKFILL_LOCK_KEY})::bigint)`,
          );

          return work({
            async backfillOrders() {
              const updated = await tx
                .update(schema.orders)
                .set({
                  squareLocationId: location.id,
                  pickupLocationName: location.name,
                  pickupLocationAddress: location.address,
                  pickupLocationCity: location.city,
                  pickupLocationPhone: location.phone,
                  pickupLocationTimezone: location.timezone,
                  pickupLocationHours: location.businessHours,
                })
                .where(isNull(schema.orders.squareLocationId))
                .returning({ id: schema.orders.id });
              return updated.length;
            },

            async backfillHolds() {
              const updated = await tx
                .update(schema.slotHolds)
                .set({ squareLocationId: location.id })
                .where(isNull(schema.slotHolds.squareLocationId))
                .returning({ id: schema.slotHolds.id });
              return updated.length;
            },

            async backfillBlackouts() {
              const legacyRows = await tx
                .select({ id: schema.blackoutDates.id, date: schema.blackoutDates.date })
                .from(schema.blackoutDates)
                .where(isNull(schema.blackoutDates.squareLocationId))
                .orderBy(desc(schema.blackoutDates.createdAt), asc(schema.blackoutDates.id));
              const scopedRows = await tx
                .select({ id: schema.blackoutDates.id, date: schema.blackoutDates.date })
                .from(schema.blackoutDates)
                .where(eq(schema.blackoutDates.squareLocationId, location.id));
              const plan = planScopedLegacyRows(legacyRows, scopedRows, (row) => row.date);
              const discarded = plan.discardIds.length
                ? await tx
                    .delete(schema.blackoutDates)
                    .where(
                      and(
                        isNull(schema.blackoutDates.squareLocationId),
                        inArray(schema.blackoutDates.id, plan.discardIds),
                      ),
                    )
                    .returning({ id: schema.blackoutDates.id })
                : [];
              const updated = plan.updateIds.length
                ? await tx
                    .update(schema.blackoutDates)
                    .set({ squareLocationId: location.id })
                    .where(
                      and(
                        isNull(schema.blackoutDates.squareLocationId),
                        inArray(schema.blackoutDates.id, plan.updateIds),
                      ),
                    )
                    .returning({ id: schema.blackoutDates.id })
                : [];
              return { updated: updated.length, discarded: discarded.length };
            },

            async backfillSlotLimits() {
              const legacyRows = await tx
                .select({
                  id: schema.slotCapacity.id,
                  date: schema.slotCapacity.pickupDate,
                  time: schema.slotCapacity.pickupTime,
                })
                .from(schema.slotCapacity)
                .where(isNull(schema.slotCapacity.squareLocationId))
                .orderBy(desc(schema.slotCapacity.createdAt), asc(schema.slotCapacity.id));
              const scopedRows = await tx
                .select({
                  id: schema.slotCapacity.id,
                  date: schema.slotCapacity.pickupDate,
                  time: schema.slotCapacity.pickupTime,
                })
                .from(schema.slotCapacity)
                .where(eq(schema.slotCapacity.squareLocationId, location.id));
              const keyOf = (row: { date: string; time: string }) => `${row.date}\u0000${row.time}`;
              const plan = planScopedLegacyRows(legacyRows, scopedRows, keyOf);
              const discarded = plan.discardIds.length
                ? await tx
                    .delete(schema.slotCapacity)
                    .where(
                      and(
                        isNull(schema.slotCapacity.squareLocationId),
                        inArray(schema.slotCapacity.id, plan.discardIds),
                      ),
                    )
                    .returning({ id: schema.slotCapacity.id })
                : [];
              const updated = plan.updateIds.length
                ? await tx
                    .update(schema.slotCapacity)
                    .set({ squareLocationId: location.id })
                    .where(
                      and(
                        isNull(schema.slotCapacity.squareLocationId),
                        inArray(schema.slotCapacity.id, plan.updateIds),
                      ),
                    )
                    .returning({ id: schema.slotCapacity.id })
                : [];
              return { updated: updated.length, discarded: discarded.length };
            },

            async backfillLineItems() {
              const variationsByProduct = new Map<string, string[]>();
              for (const [variationId, productId] of productByVariation) {
                const variationIds = variationsByProduct.get(productId) ?? [];
                variationIds.push(variationId);
                variationsByProduct.set(productId, variationIds);
              }

              let updatedItems = 0;
              for (const [productId, variationIds] of variationsByProduct) {
                const updated = await tx
                  .update(schema.orderItems)
                  .set({ squareProductId: productId })
                  .where(
                    and(
                      isNull(schema.orderItems.squareProductId),
                      inArray(schema.orderItems.squareCatalogObjectId, variationIds),
                    ),
                  )
                  .returning({ id: schema.orderItems.id });
                updatedItems += updated.length;
              }
              const [unresolved] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.orderItems)
                .where(isNull(schema.orderItems.squareProductId));
              const [blockingUnresolved] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.orderItems)
                .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
                .where(and(
                  isNull(schema.orderItems.squareProductId),
                  inArray(schema.orders.status, ["pending_payment", "paid", "preparing", "ready"]),
                ));
              return {
                updated: updatedItems,
                unresolved: unresolved?.count ?? 0,
                blockingUnresolved: blockingUnresolved?.count ?? 0,
              };
            },
          });
        },
        // READ COMMITTED is intentional: a second invocation may wait on the
        // advisory lock, then must see the first invocation's committed rows.
        { isolationLevel: "read committed", accessMode: "read write" },
      ),
  };
}

async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  loadLocalEnvironment();
  const strict = args.includes("--strict");
  const config = readLegacyBackfillConfig();
  const square = new SquareClient({
    token: config.squareAccessToken,
    environment:
      config.squareEnvironment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });

  // Resolve every external input before opening the write transaction.
  const location = await loadLegacyLocation(square, config.legacyLocationId);
  const productByVariation = await loadVariationProductIds(square);

  const postgresClient = postgres(config.databaseUrl, { prepare: false, max: 1 });
  const database = drizzle(postgresClient, { schema });

  try {
    const result = await executeLegacyBackfill(
      createDrizzleRepository(database, location, productByVariation),
      { requireResolvedLineItems: strict },
    );
    console.log(
      `Backfilled ${result.orders} orders, ${result.holds} holds, ` +
        `${result.blackouts} closures, ${result.slotLimits} slot limits, and ` +
        `${result.lineItems} line items for ${location.name}.`,
    );
    if (result.duplicateBlackouts || result.duplicateSlotLimits) {
      console.log(
        `Kept existing location-scoped overrides and removed ` +
          `${result.duplicateBlackouts} duplicate closures and ` +
          `${result.duplicateSlotLimits} duplicate slot limits.`,
      );
    }
    if (result.unresolvedLineItems) {
      console.warn(
        `${result.unresolvedLineItems} historical line items remain without a Square parent item. ` +
          "They were preserved for audit and remain unavailable for automatic cancellation.",
      );
    }
  } finally {
    await postgresClient.end();
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entrypoint === import.meta.url) {
  main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}
