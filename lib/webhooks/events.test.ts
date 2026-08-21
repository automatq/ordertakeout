import { describe, expect, it } from "vitest";

import {
  classifyRefundStatus,
  isActiveCancellationRefund,
  isExpectedOrderPayment,
  isFullOrderRefund,
  isPaymentCaptured,
  isRefundCompleted,
  mapFulfillmentState,
  parseSquareEvent,
  shouldApplyStatus,
} from "./events";

/* -------------------------------------------------------------------------- */
/* Fixtures use Square's real snake_case wire format, not the SDK's camelCase  */
/* types — see the note in events.ts.                                          */
/* -------------------------------------------------------------------------- */

function fulfillmentEvent(newState: string, orderId = "SQ_ORDER_1") {
  return {
    merchant_id: "MERCHANT",
    type: "order.fulfillment.updated",
    event_id: "evt_fulfillment_1",
    created_at: "2026-03-02T18:00:00Z",
    data: {
      type: "order_fulfillment_updated",
      id: orderId,
      object: {
        order_fulfillment_updated: {
          order_id: orderId,
          version: 3,
          state: "OPEN",
          fulfillment_update: [
            { fulfillment_uid: "F1", old_state: "PROPOSED", new_state: newState },
          ],
        },
      },
    },
  };
}

function paymentEvent(status: string, orderId: string | null = "SQ_ORDER_1") {
  return {
    merchant_id: "MERCHANT",
    type: "payment.updated",
    event_id: "evt_payment_1",
    data: {
      type: "payment",
      id: "PAY_1",
      object: {
        payment: {
          id: "PAY_1",
          order_id: orderId ?? undefined,
          status,
          amount_money: { amount: 2400, currency: "CAD" },
          location_id: "TORONTO_WEST",
          reference_id: "PT-1001",
        },
      },
    },
  };
}

function refundEvent(status: string, amount = 2400, currency = "CAD") {
  return {
    type: "refund.updated",
    event_id: "evt_refund_1",
    created_at: "2026-08-20T12:00:00Z",
    data: {
      object: {
        refund: {
          id: "REFUND_1",
          payment_id: "PAY_1",
          order_id: "SQ_ORDER_1",
          location_id: "TORONTO_WEST",
          status,
          amount_money: { amount, currency },
        },
      },
    },
  };
}

describe("parseSquareEvent", () => {
  it("reads a fulfillment update", () => {
    const result = parseSquareEvent(fulfillmentEvent("PREPARED"));
    expect(result).toEqual({
      ok: true,
      event: {
        kind: "fulfillment",
        eventId: "evt_fulfillment_1",
        type: "order.fulfillment.updated",
        squareOrderId: "SQ_ORDER_1",
        newState: "PREPARED",
      },
    });
  });

  it("takes the latest state when Square batches several updates", () => {
    const event = fulfillmentEvent("RESERVED");
    event.data.object.order_fulfillment_updated.fulfillment_update = [
      { fulfillment_uid: "F1", old_state: "PROPOSED", new_state: "RESERVED" },
      { fulfillment_uid: "F1", old_state: "RESERVED", new_state: "PREPARED" },
    ];
    const result = parseSquareEvent(event);
    expect(result.ok && result.event.kind === "fulfillment" && result.event.newState).toBe(
      "PREPARED",
    );
  });

  it("survives a fulfillment update with no state changes", () => {
    const event = fulfillmentEvent("RESERVED");
    event.data.object.order_fulfillment_updated.fulfillment_update = [];
    const result = parseSquareEvent(event);
    expect(result.ok && result.event.kind === "fulfillment" && result.event.newState).toBeNull();
  });

  it("reads a payment update", () => {
    const result = parseSquareEvent(paymentEvent("COMPLETED"));
    expect(result).toEqual({
      ok: true,
      event: {
        kind: "payment",
        eventId: "evt_payment_1",
        type: "payment.updated",
        paymentId: "PAY_1",
        squareOrderId: "SQ_ORDER_1",
        status: "COMPLETED",
        amountCents: 2400,
        currency: "CAD",
        locationId: "TORONTO_WEST",
        referenceId: "PT-1001",
      },
    });
  });

  it("reads a payment with no associated order", () => {
    const result = parseSquareEvent(paymentEvent("COMPLETED", null));
    expect(result.ok && result.event.kind === "payment" && result.event.squareOrderId).toBeNull();
  });

  it("reads a refund update used to reconcile cancellation", () => {
    expect(parseSquareEvent(refundEvent("COMPLETED"))).toEqual({
      ok: true,
      event: {
        kind: "refund",
        eventId: "evt_refund_1",
        type: "refund.updated",
        createdAt: "2026-08-20T12:00:00Z",
        refundId: "REFUND_1",
        paymentId: "PAY_1",
        squareOrderId: "SQ_ORDER_1",
        locationId: "TORONTO_WEST",
        status: "COMPLETED",
        amountCents: 2400,
        currency: "CAD",
      },
    });
  });

  it("records unrecognised event types instead of rejecting them", () => {
    // Square adds event types over time; an unknown one must still be stored for
    // idempotency and acknowledged, not retried forever.
    const result = parseSquareEvent({ type: "inventory.count.updated", event_id: "evt_x" });
    expect(result).toEqual({
      ok: true,
      event: { kind: "other", eventId: "evt_x", type: "inventory.count.updated" },
    });
  });

  it("rejects a payload with no event id", () => {
    expect(parseSquareEvent({ type: "payment.updated" }).ok).toBe(false);
    expect(parseSquareEvent({}).ok).toBe(false);
    expect(parseSquareEvent(null).ok).toBe(false);
  });

  it("does not accept the SDK's camelCase shape", () => {
    // Guards the snake_case decision: if someone "fixes" the schemas to match the
    // SDK types, this catches it rather than the endpoint silently going deaf.
    const camel = {
      type: "order.fulfillment.updated",
      eventId: "evt_1",
      data: { object: { orderFulfillmentUpdated: { orderId: "SQ_1" } } },
    };
    expect(parseSquareEvent(camel).ok).toBe(false);
  });
});

describe("mapFulfillmentState", () => {
  it("maps Square's pickup states onto ours", () => {
    expect(mapFulfillmentState("RESERVED")).toBe("paid");
    expect(mapFulfillmentState("PREPARED")).toBe("ready");
    expect(mapFulfillmentState("COMPLETED")).toBe("completed");
    expect(mapFulfillmentState("CANCELED")).toBe("canceled");
    expect(mapFulfillmentState("FAILED")).toBe("canceled");
  });

  it("treats PROPOSED and unknown states as carrying no information", () => {
    expect(mapFulfillmentState("PROPOSED")).toBeNull();
    expect(mapFulfillmentState("SOMETHING_NEW")).toBeNull();
    expect(mapFulfillmentState(null)).toBeNull();
  });
});

describe("shouldApplyStatus", () => {
  it("applies forward transitions", () => {
    expect(shouldApplyStatus("paid", "preparing")).toBe(true);
    expect(shouldApplyStatus("preparing", "ready")).toBe(true);
    expect(shouldApplyStatus("ready", "completed")).toBe(true);
    expect(shouldApplyStatus("pending_payment", "paid")).toBe(true);
  });

  it("never knocks an order backwards", () => {
    // The real scenario: the kitchen marks an order Preparing on our dashboard,
    // then Square emits RESERVED (which maps to `paid`). Without this guard the
    // order would visibly jump back a step on the kitchen screen.
    expect(shouldApplyStatus("preparing", "paid")).toBe(false);
    expect(shouldApplyStatus("ready", "paid")).toBe(false);
    expect(shouldApplyStatus("completed", "ready")).toBe(false);
    expect(shouldApplyStatus("completed", "paid")).toBe(false);
  });

  it("ignores a repeat of the current status", () => {
    expect(shouldApplyStatus("ready", "ready")).toBe(false);
    expect(shouldApplyStatus("canceled", "canceled")).toBe(false);
  });

  it("allows cancellation from any live state", () => {
    expect(shouldApplyStatus("pending_payment", "canceled")).toBe(true);
    expect(shouldApplyStatus("paid", "canceled")).toBe(true);
    expect(shouldApplyStatus("ready", "canceled")).toBe(true);
    expect(shouldApplyStatus("completed", "canceled")).toBe(true);
  });

  it("never resurrects a cancelled order", () => {
    for (const next of ["pending_payment", "paid", "preparing", "ready", "completed"] as const) {
      expect(shouldApplyStatus("canceled", next)).toBe(false);
    }
  });
});

describe("isPaymentCaptured", () => {
  it("recognises only completed payments as captured", () => {
    expect(isPaymentCaptured("COMPLETED")).toBe(true);
    expect(isPaymentCaptured("APPROVED")).toBe(false);
  });

  it("does not treat pending or failed payments as money received", () => {
    for (const status of ["PENDING", "FAILED", "CANCELED", null, ""]) {
      expect(isPaymentCaptured(status)).toBe(false);
    }
  });
});

describe("refund completion", () => {
  it.each([
    ["APPROVED", "completed"],
    ["COMPLETED", "completed"],
    ["PENDING", "pending"],
    ["FAILED", "failed"],
    ["REJECTED", "failed"],
    ["SOMETHING_NEW", "unknown"],
    [null, "unknown"],
  ] as const)("classifies %s as %s", (status, expected) => {
    expect(classifyRefundStatus(status)).toBe(expected);
  });

  it("supports Square's terminal refund labels but not pending acceptance", () => {
    expect(isRefundCompleted("COMPLETED")).toBe(true);
    expect(isRefundCompleted("APPROVED")).toBe(true);
    expect(isRefundCompleted("PENDING")).toBe(false);
    expect(isRefundCompleted("FAILED")).toBe(false);
  });

  it("requires an exact full refund in the order currency", () => {
    expect(isFullOrderRefund(2400, "CAD", 2400, "cad")).toBe(true);
    expect(isFullOrderRefund(1200, "CAD", 2400, "CAD")).toBe(false);
    expect(isFullOrderRefund(2400, "USD", 2400, "CAD")).toBe(false);
    expect(isFullOrderRefund(null, null, 2400, "CAD")).toBe(false);
  });

  it("correlates only the app's active full-order cancellation", () => {
    const base = {
      refundId: "REFUND_1",
      amountCents: 2400,
      currency: "CAD",
      orderTotalCents: 2400,
      orderCurrency: "CAD",
      refundStatus: "pending" as const,
      activeRefundId: "REFUND_1",
    };
    expect(isActiveCancellationRefund(base)).toBe(true);
    expect(isActiveCancellationRefund({ ...base, amountCents: 1200 })).toBe(false);
    expect(isActiveCancellationRefund({ ...base, activeRefundId: "OTHER" })).toBe(false);
    expect(isActiveCancellationRefund({ ...base, refundStatus: "not_required" })).toBe(false);
  });
});

describe("payment correlation", () => {
  const expected = {
    amountCents: 2400,
    currency: "CAD",
    locationId: "TORONTO_WEST",
    referenceId: "PT-1001",
    orderTotalCents: 2400,
    orderCurrency: "CAD",
    orderLocationId: "TORONTO_WEST",
    orderNumber: "PT-1001",
  };

  it("requires amount, currency, location, and reference to match", () => {
    expect(isExpectedOrderPayment(expected)).toBe(true);
    expect(isExpectedOrderPayment({ ...expected, amountCents: 1200 })).toBe(false);
    expect(isExpectedOrderPayment({ ...expected, currency: "USD" })).toBe(false);
    expect(isExpectedOrderPayment({ ...expected, locationId: "LONDON" })).toBe(false);
    expect(isExpectedOrderPayment({ ...expected, referenceId: "PT-OTHER" })).toBe(false);
  });

  it("fails closed when Square omits correlation fields", () => {
    expect(isExpectedOrderPayment({ ...expected, amountCents: null })).toBe(false);
    expect(isExpectedOrderPayment({ ...expected, currency: null })).toBe(false);
    expect(isExpectedOrderPayment({ ...expected, locationId: null })).toBe(false);
    expect(isExpectedOrderPayment({ ...expected, referenceId: null })).toBe(false);
  });
});
