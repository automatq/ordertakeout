import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const MIGRATION_URL = new URL("../../drizzle/0007_payment_attempt_lease.sql", import.meta.url);

describe("payment-attempt lease migration", () => {
  it("adds separate durable payment and refund attempt state", async () => {
    const sql = await readFile(MIGRATION_URL, "utf8");

    expect(sql).toContain('ADD COLUMN "payment_attempt_key" text');
    expect(sql).toContain('ADD COLUMN "payment_attempt_source_id" text');
    expect(sql).toContain('ADD COLUMN "payment_attempt_started_at" timestamp with time zone');
    expect(sql).toContain('ADD COLUMN "refund_attempt_key" text');
    expect(sql).toContain('ADD COLUMN "refund_attempt_started_at" timestamp with time zone');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "orders_square_payment_id_key" ON "orders"',
    );
  });

  it("preserves legacy idempotency keys and protects their live reservations", async () => {
    const sql = await readFile(MIGRATION_URL, "utf8");

    expect(sql).toContain('"payment_attempt_key" = "id"::text');
    expect(sql).toContain("'PROCESSING:' || \"id\"::text");
    expect(sql).toContain('"refund_attempt_key" = \'cancel-\' || "id"::text');
    expect(sql).toContain('"refund_status" = \'pending\'');
    expect(sql.match(/9999-12-31 23:59:59\.999\+00/g)).toHaveLength(2);
    expect(sql).toContain('UPDATE "slot_holds"');
    expect(sql).toContain('UPDATE "inventory_holds"');
  });
});
