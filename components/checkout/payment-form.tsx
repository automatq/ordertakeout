"use client";

import { payments as loadSquarePayments } from "@square/web-sdk";
import type { Card, Payments } from "@square/web-payments-sdk-types";
import { useCallback, useEffect, useRef, useState } from "react";

import { AlertIcon, LockIcon } from "@/components/ui/icons";
import { STORE_INFO } from "@/lib/store";

/**
 * Square Web Payments SDK card entry.
 *
 * Card details are entered in an iframe hosted by Square and never touch our
 * servers — we only ever see a single-use token. That's what keeps card data out
 * of our PCI scope.
 *
 * The visible changes are all about the two states either side of "ready":
 * loading used to render an empty bordered box with a dead button next to it,
 * and failure collapsed the whole component to one red sentence telling the
 * customer to "call the store" without giving them the number.
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
  const [attempt, setAttempt] = useState(0);

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
    // `attempt` is the retry trigger: bumping it re-runs the whole attach.
  }, [applicationId, locationId, attempt]);

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
      <div role="alert" className="panel border-danger/30 flex flex-col gap-3 p-5">
        <p className="text-ink flex items-start gap-2 text-sm">
          <AlertIcon className="text-danger mt-0.5 h-4 w-4 shrink-0" />
          Card payment isn&rsquo;t loading right now. Your pickup time is still held.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setStatus("loading");
              setAttempt((current) => current + 1);
            }}
            className="btn btn-primary btn-sm"
          >
            Try again
          </button>
          <a href={STORE_INFO.phoneHref} className="btn btn-secondary btn-sm">
            Call {STORE_INFO.phone}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <div
          ref={containerRef}
          aria-busy={status === "loading"}
          className="rounded-control border-border bg-surface min-h-[90px] border p-3"
        />

        {/* Overlays rather than replaces the container: Square needs the real
            node mounted to attach its iframe to. */}
        {status === "loading" ? (
          <div
            role="status"
            className="rounded-control bg-surface-sunken absolute inset-0 flex items-center justify-center gap-3"
          >
            <span className="spinner text-ink-subtle" aria-hidden />
            <span className="text-ink-muted text-sm">Loading secure card form…</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitting || status !== "ready"}
        className="btn btn-primary btn-block"
      >
        {submitting ? (
          <>
            <span className="spinner" aria-hidden />
            Processing…
          </>
        ) : (
          <>
            <LockIcon className="h-4 w-4" />
            Pay {amountLabel}
          </>
        )}
      </button>

      <p className="text-ink-subtle flex items-start gap-2 text-xs">
        <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Payments are processed securely by Square. Your card details never reach our
        servers. Visa, Mastercard and American Express accepted.
      </p>
    </div>
  );
}
