import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  getOrderByNumber: vi.fn(),
  verifyOrderAccessToken: vi.fn(),
  setAccountSession: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/orders/lookup", () => ({ getOrderByNumber: mocks.getOrderByNumber }));
vi.mock("@/lib/orders/access", () => ({ verifyOrderAccessToken: mocks.verifyOrderAccessToken }));
vi.mock("@/lib/accounts/session", () => ({
  setAccountSession: mocks.setAccountSession,
  clearAccountSession: vi.fn(),
  currentAccountId: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/accounts/profile", () => ({
  createPhoneProfile: vi.fn(),
  profileFieldsSchema: { partial: () => ({ extend: () => ({ safeParse: vi.fn() }) }) },
  updateProfile: vi.fn(),
}));

import { claimCustomerAccount } from "./account";

const ORDER = {
  id: "00000000-0000-4000-8000-000000000001",
  orderNumber: "PT-123456",
  customerEmail: "maria@example.com",
  customerName: "Maria Santos",
  customerPhone: "+14165550142",
};

function select(rows: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(async () => rows),
  };
  return { select: vi.fn(() => builder) };
}

describe("claimCustomerAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrderByNumber.mockResolvedValue(ORDER);
    mocks.verifyOrderAccessToken.mockReturnValue(true);
  });

  it("never turns a forwarded order tracking link into an existing account session", async () => {
    mocks.db.mockReturnValue({ transaction: async (callback: (tx: unknown) => unknown) => callback(select([{ id: "existing-account" }])) });

    await expect(claimCustomerAccount({ orderNumber: ORDER.orderNumber, accessToken: "x".repeat(20) }))
      .resolves.toEqual({
        ok: false,
        needsSignIn: true,
        message: "An account already uses this email. Sign in to protect its orders and rewards.",
      });
    expect(mocks.setAccountSession).not.toHaveBeenCalled();
  });
});
