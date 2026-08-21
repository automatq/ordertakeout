import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: vi.fn() }));

import type { Order } from "@/lib/db/schema";
import { customerCancellationEligibility } from "./cancellation";

describe("customerCancellationEligibility", () => {
  it("locks the order while Square is processing its refund", async () => {
    const order = {
      status: "paid",
      refundStatus: "pending",
    } as Order;

    await expect(customerCancellationEligibility(order)).resolves.toEqual({
      allowed: false,
      reason: "Square is processing your refund. This order is locked until the refund is confirmed.",
    });
  });
});
