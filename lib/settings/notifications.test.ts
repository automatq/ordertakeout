import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettingFresh: vi.fn(),
  serverEnv: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("./store", () => ({ getSettingFresh: mocks.getSettingFresh }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));
vi.mock("@/lib/monitoring/report", () => ({ reportError: mocks.reportError }));

import { recipientsFromEnv, resolveStoreEmails, resolveStorePhone } from "./notifications";

const STORED = {
  useEnvFallback: false,
  storeEmails: ["front@bakery.test", "owner@bakery.test"],
  storePhone: "+15550009999",
  locationEmails: { LOC_A: "wilson@bakery.test" },
  locationPhones: { LOC_A: "+15550001111" },
};

describe("notification recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({
      STORE_NOTIFY_EMAIL: "env@bakery.test",
      STORE_NOTIFY_PHONE: "+15558887777",
      LOCATION_NOTIFY_EMAILS: JSON.stringify({ LOC_B: "envloc@bakery.test" }),
      LOCATION_NOTIFY_PHONES: undefined,
    });
  });

  it("prefers the stored location inbox, then the stored store list", async () => {
    mocks.getSettingFresh.mockResolvedValue(STORED);
    await expect(resolveStoreEmails("LOC_A")).resolves.toEqual(["wilson@bakery.test"]);
    await expect(resolveStoreEmails("LOC_B")).resolves.toEqual([
      "front@bakery.test",
      "owner@bakery.test",
    ]);
    await expect(resolveStorePhone("LOC_A")).resolves.toBe("+15550001111");
  });

  it("uses env values when nothing is stored", async () => {
    mocks.getSettingFresh.mockResolvedValue(null);
    await expect(resolveStoreEmails("LOC_B")).resolves.toEqual(["envloc@bakery.test"]);
    await expect(resolveStoreEmails(null)).resolves.toEqual(["env@bakery.test"]);
    await expect(resolveStorePhone(null)).resolves.toBe("+15558887777");
  });

  it("stays deliberately silent when stored empty with the env fallback off", async () => {
    mocks.getSettingFresh.mockResolvedValue({
      ...STORED,
      storeEmails: [],
      storePhone: null,
      locationEmails: {},
      locationPhones: {},
      useEnvFallback: false,
    });
    await expect(resolveStoreEmails("LOC_B")).resolves.toEqual([]);
    await expect(resolveStorePhone(null)).resolves.toBeNull();
  });

  it("falls through to env when stored empty but the fallback is on", async () => {
    mocks.getSettingFresh.mockResolvedValue({
      ...STORED,
      storeEmails: [],
      locationEmails: {},
      useEnvFallback: true,
    });
    await expect(resolveStoreEmails("LOC_B")).resolves.toEqual(["envloc@bakery.test"]);
  });

  it("reports malformed env maps instead of silently ignoring them", () => {
    mocks.serverEnv.mockReturnValue({
      STORE_NOTIFY_EMAIL: undefined,
      STORE_NOTIFY_PHONE: undefined,
      LOCATION_NOTIFY_EMAILS: "{not json",
      LOCATION_NOTIFY_PHONES: undefined,
    });
    const recipients = recipientsFromEnv();
    expect(recipients.locationEmails).toEqual({});
    expect(mocks.reportError).toHaveBeenCalledWith(
      "notifications",
      expect.stringContaining("not valid JSON"),
    );
  });
});
