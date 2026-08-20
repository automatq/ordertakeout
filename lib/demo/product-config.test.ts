import { describe, expect, it } from "vitest";

import { matchProductConfig, planDemoProductConfigs } from "./product-config";

const RULES = [{ productId: "DEMO_ITEM_ENSAYMADA", slug: "ensaymada-tray" }] as const;

describe("planDemoProductConfigs", () => {
  it("upserts an empty or exact demo configuration", () => {
    expect(planDemoProductConfigs([], RULES)[0]).toMatchObject({ action: "upsert" });
    expect(planDemoProductConfigs([
      { productId: "DEMO_ITEM_ENSAYMADA", slug: "ensaymada-tray" },
    ], RULES)[0]).toMatchObject({ action: "upsert" });
  });

  it("reuses a same-slug Square configuration without replacing its ID", () => {
    expect(planDemoProductConfigs([
      { productId: "LIVE_SQUARE_ITEM", slug: "ensaymada-tray" },
    ], RULES)[0]).toEqual({
      demoProductId: "DEMO_ITEM_ENSAYMADA",
      configuredProductId: "LIVE_SQUARE_ITEM",
      slug: "ensaymada-tray",
      action: "reuse",
    });
  });

  it("rejects a demo ID already attached to another slug", () => {
    expect(() => planDemoProductConfigs([
      { productId: "DEMO_ITEM_ENSAYMADA", slug: "another-product" },
    ], RULES)).toThrow(/already assigned/);
  });
});

describe("matchProductConfig", () => {
  const configs = [{
    productId: "LIVE_SQUARE_ITEM",
    slug: "ensaymada-tray",
    leadTimeDays: 1,
  }];

  it("uses the known slug fallback only in demo mode", () => {
    expect(matchProductConfig("DEMO_ITEM_ENSAYMADA", configs, RULES, true)?.productId)
      .toBe("LIVE_SQUARE_ITEM");
    expect(matchProductConfig("DEMO_ITEM_ENSAYMADA", configs, RULES, false))
      .toBeUndefined();
  });
});
