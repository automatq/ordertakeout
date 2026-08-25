import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: vi.fn() }));

import { isSlugConflict } from "./queries";

describe("isSlugConflict", () => {
  it("recognises two products claiming one URL name", () => {
    // Without this the race surfaces as the form's generic catch, which tells
    // staff to "check your connection" for a naming problem.
    expect(
      isSlugConflict({ code: "23505", constraint: "products_config_slug_key" }),
    ).toBe(true);
  });

  it("does not swallow a different unique violation", () => {
    expect(isSlugConflict({ code: "23505", constraint: "orders_order_number_key" })).toBe(false);
    expect(isSlugConflict({ code: "23503", constraint: "products_config_slug_key" })).toBe(false);
  });

  it("is safe on things that are not database errors", () => {
    expect(isSlugConflict(new Error("boom"))).toBe(false);
    expect(isSlugConflict(null)).toBe(false);
    expect(isSlugConflict(undefined)).toBe(false);
  });
});
