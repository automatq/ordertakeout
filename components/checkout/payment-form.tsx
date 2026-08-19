"use client";

import { payments as loadSquarePayments } from "@square/web-sdk";
import type { Card, Payments } from "@square/web-payments-sdk-types";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Square Web Payments SDK card entry.
 *
 * Card details are entered in an iframe hosted by Square and never touch our
 * servers — we only ever see a single-use token. That's what keeps card data out
 * of our PCI scope.
 */
export function PaymentForm({
  applicationId,
  locationId,
  amountLabel,
  disabled,
  onToken,
}: {
  applicationId: string;
  locationId: string;
  amountLabel: string;
  disabled?: boolean;
  onToken: (token: string) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<Card | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let card: Card | null = null;

    async function attach() {
      try {
        const payments: Payments | null = await loadSquarePayments(applicationId, locationId);
        if (!payments) throw new Error("Square payments failed to load");

        card = await payments.card();
        if (cancelled || !containerRef.current) return;

        await card.attach(containerRef.current);
        cardRef.current = card;
        setStatus("ready");
      } catch (cause) {
        console.error("[checkout] Square card form failed to load:", cause);
        if (!cancelled) setStatus("failed");
      }
    }

    void attach();

    return () => {
      cancelled = true;
      // Detach on unmount, otherwise a remount leaves a second iframe behind.
      void card?.destroy();
      cardRef.current = null;
    };
  }, [applicationId, locationId]);

  const handleSubmit = useCallback(async () => {
    const card = cardRef.current;
    if (!card || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      // Checked separately so the failure branch narrows to ErrorTokenResult,
      // which is the only variant carrying `errors`.
      const result = await card.tokenize();
      if (result.status !== "OK") {
        const detail = "errors" in result ? result.errors?.[0]?.message : undefined;
        setError(detail ?? "Please check your card details and try again.");
        return;
      }
      if (!result.token) {
        setError("Please check your card details and try again.");
        return;
      }
      await onToken(result.token);
    } catch (cause) {
      console.error("[checkout] tokenization failed:", cause);
      setError("We couldn't process that card. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [onToken, submitting]);

  if (status === "failed") {
    return (
      <p role="alert" className="text-danger text-sm">
        Card payment is unavailable right now. Please call the store to place your order.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="rounded-control border-border bg-surface min-h-[90px] border p-3"
      />

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitting || status !== "ready"}
        className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover px-5 py-3 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Processing…" : `Pay ${amountLabel}`}
      </button>

      <p className="text-ink-subtle text-xs">
        Payments are processed securely by Square. Your card details never reach our
        servers.
      </p>
    </div>
  );
}
