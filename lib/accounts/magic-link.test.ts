import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { consumeMagicLink, issueMagicLink, MAGIC_LINK_TTL_MINUTES } from "./magic-link";

const NOW = new Date("2026-08-23T12:00:00Z");
const ACCOUNT = { id: "00000000-0000-4000-8000-000000000001", email: "maria@example.com", name: "Maria Santos" };

function chain(result: unknown[]) {
  // Every drizzle builder method returns the same thenable so any select/
  // update/insert shape resolves to `result`.
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => void) => resolve(result);
      }
      return vi.fn(() => proxy);
    },
  });
  return proxy;
}

beforeEach(() => {
  mocks.db.mockReset();
});

describe("issueMagicLink", () => {
  it("returns null for an unknown email — the caller must answer identically anyway", async () => {
    mocks.db.mockReturnValue({ select: vi.fn(() => chain([])) });
    expect(await issueMagicLink("nobody@example.com", NOW)).toBeNull();
  });

  it("refuses to mint past the outstanding-link cap", async () => {
    const select = vi.fn()
      .mockReturnValueOnce(chain([ACCOUNT]))
      .mockReturnValueOnce(chain([{ value: 3 }]));
    mocks.db.mockReturnValue({ select, insert: vi.fn() });

    expect(await issueMagicLink(ACCOUNT.email, NOW)).toBeNull();
  });

  it("stores only the sha256 of the returned token, with a 15-minute expiry", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const select = vi.fn()
      .mockReturnValueOnce(chain([ACCOUNT]))
      .mockReturnValueOnce(chain([{ value: 0 }]));
    const insert = vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        inserted.push(row);
        return chain([]);
      }),
    }));
    mocks.db.mockReturnValue({ select, insert });

    const issued = await issueMagicLink("  MARIA@Example.com ", NOW);

    expect(issued?.account).toEqual(ACCOUNT);
    expect(issued!.token.length).toBeGreaterThanOrEqual(40);
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row["tokenHash"]).toBe(createHash("sha256").update(issued!.token).digest("hex"));
    expect(row["tokenHash"]).not.toContain(issued!.token);
    expect((row["expiresAt"] as Date).getTime()).toBe(NOW.getTime() + MAGIC_LINK_TTL_MINUTES * 60_000);
  });
});

describe("consumeMagicLink", () => {
  it("resolves the account when the atomic update claims a row", async () => {
    mocks.db.mockReturnValue({ update: vi.fn(() => chain([{ accountId: ACCOUNT.id }])) });
    expect(await consumeMagicLink("some-token", NOW)).toEqual({ accountId: ACCOUNT.id });
  });

  it("returns null when the token is unknown, used, or expired", async () => {
    mocks.db.mockReturnValue({ update: vi.fn(() => chain([])) });
    expect(await consumeMagicLink("burned-token", NOW)).toBeNull();
    expect(await consumeMagicLink("", NOW)).toBeNull();
  });
});
