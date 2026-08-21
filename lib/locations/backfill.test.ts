import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { CatalogObject } from "square";
import { describe, expect, it, vi } from "vitest";

import {
  executeLegacyBackfill,
  loadVariationProductIds,
  mapVariationProductIds,
  planScopedLegacyRows,
  readLegacyBackfillConfig,
  type LegacyBackfillOperations,
  type LegacyBackfillRepository,
} from "../../scripts/backfill-legacy-location";

describe("legacy location backfill planning", () => {
  it("requires only the credentials the standalone command actually uses", () => {
    expect(
      readLegacyBackfillConfig({
        DATABASE_URL: "postgres://example",
        SQUARE_ACCESS_TOKEN: "token",
        NEXT_PUBLIC_SQUARE_ENVIRONMENT: "sandbox",
        LEGACY_SQUARE_LOCATION_ID: "LOC_1",
      }),
    ).toEqual({
      databaseUrl: "postgres://example",
      squareAccessToken: "token",
      squareEnvironment: "sandbox",
      legacyLocationId: "LOC_1",
    });

    expect(() =>
      readLegacyBackfillConfig({
        DATABASE_URL: "postgres://example",
        SQUARE_ACCESS_TOKEN: "token",
        NEXT_PUBLIC_SQUARE_ENVIRONMENT: "staging",
        LEGACY_SQUARE_LOCATION_ID: "LOC_1",
      }),
    ).toThrow("must be sandbox or production");
  });

  it("maps every nested Square variation to its parent item", () => {
    const objects = [
      {
        type: "ITEM",
        id: "ITEM_1",
        itemData: {
          isArchived: true,
          variations: [
            { type: "ITEM_VARIATION", id: "VAR_1" },
            { type: "ITEM_VARIATION", id: "VAR_2" },
          ],
        },
      },
      {
        type: "ITEM_VARIATION",
        id: "VAR_DELETED",
        isDeleted: true,
        itemVariationData: { itemId: "ITEM_DELETED" },
      },
      { type: "CATEGORY", id: "CATEGORY_1" },
    ] as CatalogObject[];

    expect([...mapVariationProductIds(objects)]).toEqual([
      ["VAR_1", "ITEM_1"],
      ["VAR_2", "ITEM_1"],
      ["VAR_DELETED", "ITEM_DELETED"],
    ]);
  });

  it("paginates through current and deleted Square catalog objects", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [
          {
            type: "ITEM_VARIATION",
            id: "VAR_DELETED",
            isDeleted: true,
            itemVariationData: { itemId: "ITEM_DELETED" },
          },
        ],
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        objects: [
          {
            type: "ITEM_VARIATION",
            id: "VAR_ACTIVE",
            itemVariationData: { itemId: "ITEM_ACTIVE" },
          },
        ],
      });

    const mapped = await loadVariationProductIds({ catalog: { search } } as never);

    expect([...mapped]).toEqual([
      ["VAR_DELETED", "ITEM_DELETED"],
      ["VAR_ACTIVE", "ITEM_ACTIVE"],
    ]);
    expect(search).toHaveBeenNthCalledWith(1, {
      objectTypes: ["ITEM", "ITEM_VARIATION"],
      includeDeletedObjects: true,
      limit: 1_000,
    });
    expect(search).toHaveBeenNthCalledWith(2, {
      objectTypes: ["ITEM", "ITEM_VARIATION"],
      includeDeletedObjects: true,
      limit: 1_000,
      cursor: "next-page",
    });
  });

  it("keeps explicit scoped overrides and collapses duplicate legacy rows", () => {
    const plan = planScopedLegacyRows(
      [
        { id: "legacy-newest", key: "2026-09-01/16:00" },
        { id: "legacy-older", key: "2026-09-01/16:00" },
        { id: "legacy-collision", key: "2026-09-02/16:00" },
      ],
      [{ id: "scoped", key: "2026-09-02/16:00" }],
      (row) => row.key,
    );

    expect(plan).toEqual({
      updateIds: ["legacy-newest"],
      discardIds: ["legacy-older", "legacy-collision"],
    });
  });
});

describe("executeLegacyBackfill", () => {
  function operations(
    overrides: Partial<LegacyBackfillOperations> = {},
  ): LegacyBackfillOperations {
    return {
      backfillOrders: vi.fn(async () => 2),
      backfillHolds: vi.fn(async () => 3),
      backfillBlackouts: vi.fn(async () => ({ updated: 4, discarded: 1 })),
      backfillSlotLimits: vi.fn(async () => ({ updated: 5, discarded: 2 })),
      backfillLineItems: vi.fn(async () => ({ updated: 6, unresolved: 1, blockingUnresolved: 1 })),
      ...overrides,
    };
  }

  it("runs every mutation through one transaction and reports actual counts", async () => {
    const steps = operations();
    const transaction = vi.fn(async (work: Parameters<LegacyBackfillRepository["transaction"]>[0]) =>
      work(steps),
    );

    await expect(executeLegacyBackfill({ transaction })).resolves.toEqual({
      orders: 2,
      holds: 3,
      blackouts: 4,
      duplicateBlackouts: 1,
      slotLimits: 5,
      duplicateSlotLimits: 2,
      lineItems: 6,
      unresolvedLineItems: 1,
      blockingUnresolvedLineItems: 1,
    });
    expect(transaction).toHaveBeenCalledOnce();
    for (const operation of Object.values(steps)) {
      expect(operation).toHaveBeenCalledOnce();
    }
  });

  it("does not commit earlier writes when a later mutation fails", async () => {
    const committed: string[] = [];
    const transaction: LegacyBackfillRepository["transaction"] = async (work) => {
      const staged: string[] = [];
      const steps = operations({
        backfillOrders: async () => {
          staged.push("orders");
          return 1;
        },
        backfillHolds: async () => {
          staged.push("holds");
          return 1;
        },
        backfillBlackouts: async () => {
          throw new Error("collision");
        },
      });

      const result = await work(steps);
      committed.push(...staged);
      return result;
    };

    await expect(executeLegacyBackfill({ transaction })).rejects.toThrow("collision");
    expect(committed).toEqual([]);
  });

  it("rolls back the whole backfill when any legacy line item cannot be resolved", async () => {
    const committed: string[] = [];
    const transaction: LegacyBackfillRepository["transaction"] = async (work) => {
      const staged: string[] = [];
      const steps = operations({
        backfillOrders: async () => {
          staged.push("orders");
          return 1;
        },
      });
      const result = await work(steps);
      committed.push(...staged);
      return result;
    };

    await expect(executeLegacyBackfill(
      { transaction },
      { requireResolvedLineItems: true },
    )).rejects.toThrow("refusing to commit a partial backfill");
    expect(committed).toEqual([]);
  });

  it("preserves unresolved historical line items without blocking the location migration", async () => {
    const steps = operations({
      backfillLineItems: async () => ({
        updated: 0,
        unresolved: 5,
        blockingUnresolved: 0,
      }),
    });
    const transaction = vi.fn(async (work: Parameters<LegacyBackfillRepository["transaction"]>[0]) =>
      work(steps),
    );

    await expect(executeLegacyBackfill(
      { transaction },
      { requireResolvedLineItems: true },
    )).resolves.toMatchObject({
      unresolvedLineItems: 5,
      blockingUnresolvedLineItems: 0,
    });
  });
});

describe("legacy location backfill CLI", () => {
  it("boots under plain Node/tsx without Next server-only or cache context", () => {
    const root = resolve(import.meta.dirname, "../..");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/backfill-legacy-location.ts", "--help"],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Backfill pre-multi-location rows");
    expect(result.stderr).not.toContain("server-only");
    expect(result.stderr).not.toContain("cacheLife");
  });

  it("loads CLI configuration from the working directory's .env.local", () => {
    const root = resolve(import.meta.dirname, "../..");
    const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "harina-backfill-"));
    writeFileSync(
      resolve(temporaryDirectory, ".env.local"),
      [
        "DATABASE_URL=postgres://example",
        "SQUARE_ACCESS_TOKEN=token",
        "NEXT_PUBLIC_SQUARE_ENVIRONMENT=staging",
        "LEGACY_SQUARE_LOCATION_ID=LOC_1",
      ].join("\n"),
    );

    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          resolve(root, "node_modules/tsx/dist/loader.mjs"),
          resolve(root, "scripts/backfill-legacy-location.ts"),
        ],
        {
          cwd: temporaryDirectory,
          encoding: "utf8",
          env: { NODE_ENV: "development" },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("must be sandbox or production");
      expect(result.stderr).not.toContain("is required");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
