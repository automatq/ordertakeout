import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickupShopsResponseSchema } from "@/lib/api/dto";

const mocks = vi.hoisted(() => ({ getStoreLocationsSafe: vi.fn() }));

vi.mock("@/lib/locations/server", () => ({
  getStoreLocationsSafe: mocks.getStoreLocationsSafe,
}));

const { GET } = await import("./route");

const location = (overrides: Record<string, unknown> = {}) => ({
  id: "LOC-1",
  name: "Harina Bakeshoppe — Wilson",
  address: "314 Wilson Avenue",
  city: "North York, ON",
  phone: "+14165550100",
  timezone: "America/Toronto",
  // Present on the type for the digital wallets' payment request, not for a picker.
  currency: "CAD",
  country: "CA",
  coordinates: { latitude: 43.7, longitude: -79.4 },
  businessHours: [{ dayOfWeek: "MON", startTime: "09:00", endTime: "18:00" }],
  ...overrides,
});

beforeEach(() => {
  mocks.getStoreLocationsSafe.mockReset();
  mocks.getStoreLocationsSafe.mockResolvedValue([location()]);
});

describe("GET /api/v1/locations", () => {
  it("lists the shops under the strict schema", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const { data } = await response.json();
    expect(() => pickupShopsResponseSchema.parse(data)).not.toThrow();
    expect(data.shops[0]).toMatchObject({ id: "LOC-1", city: "North York, ON" });
  });

  it("leaves out the fields that exist for payments, not for choosing a shop", async () => {
    const raw = JSON.stringify(await (await GET()).json());
    for (const field of ["currency", "country", "timezone"]) {
      expect(raw).not.toContain(field);
    }
  });

  it("reports a Square outage rather than claiming the shop has no branches", async () => {
    /* getStoreLocationsSafe swallows the failure and returns [], which is right
       for a page with other things to render. Here it is the whole answer, and
       "we have no shops" is a different sentence from "we couldn't reach
       Square" — one of them makes a customer give up. */
    mocks.getStoreLocationsSafe.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  });
});
