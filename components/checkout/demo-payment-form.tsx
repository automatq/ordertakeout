"use client";

import { useState } from "react";

/**
 * Stand-in for the Square card form when running in demo mode.
 *
 * Square's Web Payments SDK needs a real application id to render its iframe, so
 * a demo without credentials can't use it. This produces a fake token that
 * `createSquarePayment` recognises, letting the whole checkout — reservation,
 * order creation, payment, confirmation — run end to end.
 *
 * The decline option exists so the failure path can be demoed too. A demo that
 * only ever shows the happy path is how failure handling goes unnoticed until a
 * real customer finds it.
 */
export function DemoPaymentForm({
  amountLabel,
  onToken,
}: {
  amountLabel: string;
  onToken: (token: string) => Promise<void>;
}) {
  const [decline, setDecline] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handlePay() {
    setSubmitting(true);
    try {
      await onToken(decline ? "demo-source-decline" : "demo-source-ok");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className="rounded-control border-accent bg-accent-soft border border-dashed p-4"
      >
        <p className="text-accent-ink text-sm font-semibold">Demo mode — no card required</p>
        <p className="text-ink-muted mt-1 text-sm">
          No real payment is taken and nothing is sent to Square. Everything else —
          pickup rules, slot limits, the kitchen screen — is running for real.
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={decline}
          onChange={(e) => setDecline(e.target.checked)}
          className="accent-brand"
        />
        <span className="text-ink-muted text-sm">Simulate a declined card</span>
      </label>

      <button
        type="button"
        onClick={handlePay}
        disabled={submitting}
        className="btn btn-primary btn-block"
      >
        {submitting ? (
          <>
            <span className="spinner" aria-hidden />
            Processing…
          </>
        ) : (
          `Pay ${amountLabel} (demo)`
        )}
      </button>
    </div>
  );
}
