import { describe, expect, it } from "vitest";

import { accountingTransactionsCsv, parseAccountingExportFilter } from "./accounting-export";

describe("accounting export", () => {
  it("keeps payments, refunds, tax, and immutable Square identifiers explicit", () => {
    const csv = accountingTransactionsCsv([
      {
        transactionType: "payment",
        transactionDate: "2026-08-22",
        transactionId: "payment:PAY_1",
        orderNumber: "PT-123",
        squareOrderId: "ORDER_1",
        squarePaymentId: "PAY_1",
        squareRefundId: null,
        locationId: "LOC_1",
        locationName: "Toronto, East",
        currency: "CAD",
        netSalesCents: 4500,
        taxCents: 585,
        tipCents: 700,
        grossCents: 5785,
        refundCents: 0,
      },
      {
        transactionType: "refund",
        transactionDate: "2026-08-23",
        transactionId: "refund:REF_1",
        orderNumber: "PT-123",
        squareOrderId: "ORDER_1",
        squarePaymentId: "PAY_1",
        squareRefundId: "REF_1",
        locationId: "LOC_1",
        locationName: "Toronto, East",
        currency: "CAD",
        netSalesCents: -4500,
        taxCents: -585,
        tipCents: 0,
        grossCents: -5085,
        refundCents: 5085,
      },
    ]);

    expect(csv).toContain("transaction_type,transaction_date,transaction_id");
    // gross = net + tax + tip on payment rows; refunds carry the returned amount.
    expect(csv).toContain('payment,2026-08-22,payment:PAY_1,PT-123,ORDER_1,PAY_1,,LOC_1,"Toronto, East",CAD,45.00,5.85,7.00,57.85,0.00');
    expect(csv).toContain('refund,2026-08-23,refund:REF_1,PT-123,ORDER_1,PAY_1,REF_1,LOC_1,"Toronto, East",CAD,-45.00,-5.85,0.00,-50.85,50.85');
  });

  it("accepts a bounded calendar range and rejects malformed or oversized requests", () => {
    expect(parseAccountingExportFilter({ from: "2026-01-01", to: "2026-12-31", location: "LOC_1" }))
      .toEqual({ from: "2026-01-01", to: "2026-12-31", locationId: "LOC_1" });
    expect(parseAccountingExportFilter({ from: "2026-01-02", to: "2026-01-01", location: null })).toBeNull();
    expect(parseAccountingExportFilter({ from: "2026-01-01", to: "2027-01-03", location: null })).toBeNull();
    expect(parseAccountingExportFilter({ from: "2026-02-30", to: "2026-03-01", location: null })).toBeNull();
  });
});
