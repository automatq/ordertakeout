import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  getSettingFresh: vi.fn(),
  buildOrderNotification: vi.fn(),
  dispatch: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ STORE_TIMEZONE: "America/Toronto" }) }));
vi.mock("@/lib/settings/store", () => ({ getSettingFresh: mocks.getSettingFresh }));
vi.mock("@/lib/monitoring/report", () => ({ reportError: mocks.reportError }));
vi.mock("./dispatch", () => ({
  buildOrderNotification: mocks.buildOrderNotification,
  dispatch: mocks.dispatch,
}));

import { sendPickupReminders } from "./reminders";

// 12:30 UTC = 08:30 in Toronto (inside the 08:00–10:59 window), 05:30 in
// Vancouver (outside it) on the same calendar day.
const NOW = new Date("2026-08-23T12:30:00Z");

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    orderNumber: "HB-1001",
    status: "paid",
    pickupDate: "2026-08-23",
    pickupLocationTimezone: "America/Toronto",
    ...overrides,
  };
}

function selectRows(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettingFresh.mockResolvedValue(null); // code defaults: enabled, 08:00
  mocks.buildOrderNotification.mockResolvedValue({ orderId: "built" });
  mocks.dispatch.mockResolvedValue([]);
});

describe("sendPickupReminders", () => {
  it("reminds today's orders inside the local morning window, customer channels only", async () => {
    mocks.db.mockReturnValue(selectRows([order()]));

    expect(await sendPickupReminders(NOW)).toBe(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      kind: "order_reminder",
      order: { orderId: "built" },
      dedupeKey: "order_reminder:2026-08-23",
      channels: ["email_customer", "sms_customer"],
    });
  });

  it("uses each order's own timezone snapshot — Vancouver at 05:30 local waits", async () => {
    mocks.db.mockReturnValue(
      selectRows([order({ pickupLocationTimezone: "America/Vancouver" })]),
    );

    expect(await sendPickupReminders(NOW)).toBe(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("skips pickups that are not today in the order's timezone", async () => {
    mocks.db.mockReturnValue(selectRows([order({ pickupDate: "2026-08-24" })]));

    expect(await sendPickupReminders(NOW)).toBe(0);
  });

  it("does nothing when the setting disables reminders", async () => {
    mocks.getSettingFresh.mockResolvedValue({ enabled: false, startHour: 8 });
    mocks.db.mockReturnValue(selectRows([order()]));

    expect(await sendPickupReminders(NOW)).toBe(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("honours a configured later window", async () => {
    mocks.getSettingFresh.mockResolvedValue({ enabled: true, startHour: 9 });
    mocks.db.mockReturnValue(selectRows([order()])); // 08:30 Toronto < 09:00

    expect(await sendPickupReminders(NOW)).toBe(0);
  });

  it("keeps going when one order's dispatch throws", async () => {
    mocks.db.mockReturnValue(selectRows([order(), order({ id: "b", orderNumber: "HB-1002" })]));
    mocks.dispatch
      .mockRejectedValueOnce(new Error("twilio down"))
      .mockResolvedValueOnce([]);

    expect(await sendPickupReminders(NOW)).toBe(1);
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });
});
