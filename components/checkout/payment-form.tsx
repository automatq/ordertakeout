"use client";

import { payments as loadSquarePayments } from "@square/web-sdk";
import type {
  ApplePay,
  Card,
  CashAppPay,
  GooglePay,
  Payments,
  SqEvent,
  CashAppPayEventData,
} from "@square/web-payments-sdk-types";
import { useCallback, useEffect, useRef, useState } from "react";

import { AlertIcon, LockIcon } from "@/components/ui/icons";
import { STORE_INFO } from "@/lib/store";

/**
 * Square Web Payments SDK: card entry plus the digital wallets.
 *
 * Card details are entered in an iframe hosted by Square and never touch our
 * servers — we only ever see a single-use token, and the wallets emit exactly
 * the same kind of token into the same submit path, so the server knows
 * nothing about which button was pressed.
 *
 * Wallets are best-effort: each is tried independently and one that throws
 * (unsupported browser, unconfigured account) simply doesn't render — the card
 * form must never be hostage to Apple Pay's availability. The whole wallet row
 * is rebuilt when the charge total changes (a tip pick), because Cash App Pay
 * cannot update an existing payment request.
 */
export function PaymentForm({
  applicationId,
  locationId,
  amountLabel,
  totalCents,
  currency,
  countryCode,
  orderNumber,
  disabled,
  onProcessingChange,
  onToken,
}: {
  applicationId: string;
  locationId: string;
  amountLabel: string;
  /** The full charge, tip included — what the wallet sheet must show. */
  totalCents: number;
  currency: string;
  /** ISO country of the pickup location; wallets are skipped when unknown. */
  countryCode: string | null;
  orderNumber: string;
  disabled?: boolean;
  onProcessingChange?: (processing: boolean) => void;
  onToken: (token: string) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const googlePayRef = useRef<HTMLDivElement>(null);
  const cashAppRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<Card | null>(null);
  const applePayRef = useRef<ApplePay | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [wallets, setWallets] = useState<{ applePay: boolean; googlePay: boolean; cashAppPay: boolean }>({
    applePay: false,
    googlePay: false,
    cashAppPay: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const submitToken = useCallback(
    async (token: string | undefined) => {
      if (!token) {
        setError("Please check your payment details and try again.");
        return;
      }
      setSubmitting(true);
      onProcessingChange?.(true);
      setError(null);
      try {
        await onToken(token);
      } finally {
        setSubmitting(false);
        onProcessingChange?.(false);
      }
    },
    [onProcessingChange, onToken],
  );

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

  // The wallets, keyed on the charge total: Cash App Pay's payment request is
  // immutable, so a tip change tears the row down and rebuilds it.
  useEffect(() => {
    if (!countryCode || totalCents <= 0) return;
    let cancelled = false;
    let googlePay: GooglePay | null = null;
    let cashAppPay: CashAppPay | null = null;
    const onCashAppTokenized = (event: SqEvent<CashAppPayEventData>) => {
      const data = event.detail;
      if (data && "tokenResult" in data) {
        void submitToken(data.tokenResult?.status === "OK" ? data.tokenResult.token : undefined);
      }
    };

    async function attachWallets() {
      try {
        const payments: Payments | null = await loadSquarePayments(applicationId, locationId);
        if (!payments || cancelled || !countryCode) return;

        const request = payments.paymentRequest({
          countryCode,
          currencyCode: currency,
          total: { amount: (totalCents / 100).toFixed(2), label: STORE_INFO.name },
        });

        const [apple, google, cashApp] = await Promise.allSettled([
          payments.applePay(request),
          payments.googlePay(request),
          payments.cashAppPay(request, {
            redirectURL: window.location.href,
            referenceId: orderNumber,
          }),
        ]);
        if (cancelled) return;

        if (apple.status === "fulfilled") applePayRef.current = apple.value;
        if (google.status === "fulfilled" && googlePayRef.current) {
          googlePay = google.value;
          await googlePay.attach(googlePayRef.current);
        }
        if (cashApp.status === "fulfilled" && cashAppRef.current) {
          cashAppPay = cashApp.value;
          cashAppPay.addEventListener("ontokenization", onCashAppTokenized);
          await cashAppPay.attach(cashAppRef.current);
        }
        if (cancelled) return;
        setWallets({
          applePay: apple.status === "fulfilled",
          googlePay: google.status === "fulfilled",
          cashAppPay: cashApp.status === "fulfilled",
        });
      } catch {
        // Wallets are strictly optional; the card form carries checkout.
      }
    }

    void attachWallets();

    return () => {
      cancelled = true;
      applePayRef.current = null;
      cashAppPay?.removeEventListener("ontokenization", onCashAppTokenized);
      void googlePay?.destroy();
      void cashAppPay?.destroy();
      setWallets({ applePay: false, googlePay: false, cashAppPay: false });
    };
  }, [applicationId, locationId, countryCode, currency, totalCents, orderNumber, submitToken]);

  const handleCardSubmit = useCallback(async () => {
    const card = cardRef.current;
    if (!card || submitting) return;
    try {
      // Checked separately so the failure branch narrows to ErrorTokenResult,
      // which is the only variant carrying `errors`.
      const result = await card.tokenize();
      if (result.status !== "OK") {
        const detail = "errors" in result ? result.errors?.[0]?.message : undefined;
        setError(detail ?? "Please check your card details and try again.");
        return;
      }
      await submitToken(result.token);
    } catch (cause) {
      console.error("[checkout] tokenization failed:", cause);
      setError("We couldn't process that card. Please try again.");
    }
  }, [submitToken, submitting]);

  const handleApplePay = useCallback(async () => {
    const applePay = applePayRef.current;
    if (!applePay || submitting) return;
    try {
      const result = await applePay.tokenize();
      if (result.status !== "OK") {
        // A closed sheet is a change of mind, not an error worth shouting about.
        return;
      }
      await submitToken(result.token);
    } catch (cause) {
      console.error("[checkout] Apple Pay tokenization failed:", cause);
      setError("Apple Pay didn't complete. You can pay by card below.");
    }
  }, [submitToken, submitting]);

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
            disabled={disabled}
            className="btn btn-primary btn-sm rounded-full"
          >
            Try again
          </button>
          <a href={STORE_INFO.phoneHref} className="btn btn-secondary btn-sm rounded-full">
            Call {STORE_INFO.phone}
          </a>
        </div>
      </div>
    );
  }

  const anyWallet = wallets.applePay || wallets.googlePay || wallets.cashAppPay;

  return (
    <div className="flex flex-col gap-4">
      <div className={anyWallet ? "flex flex-col gap-2" : "hidden"} aria-label="Express payment">
        {wallets.applePay ? (
          <button
            type="button"
            onClick={handleApplePay}
            disabled={disabled || submitting}
            /* Apple's HIG: black pill, white lettering, no restyling. The one
               deliberate literal-color exception besides global-error. */
            style={{ background: "#000000", color: "#ffffff" }}
            className="flex min-h-12 w-full items-center justify-center rounded-full text-base font-semibold"
          >
            Buy with &#63743; Pay
          </button>
        ) : null}
        <div ref={googlePayRef} className={wallets.googlePay ? "" : "hidden"} />
        <div ref={cashAppRef} className={wallets.cashAppPay ? "" : "hidden"} />
        <div className="text-ink-subtle flex items-center gap-3 text-xs">
          <span className="bg-border h-px flex-1" aria-hidden />
          or pay with card
          <span className="bg-border h-px flex-1" aria-hidden />
        </div>
      </div>

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
        onClick={handleCardSubmit}
        disabled={disabled || submitting || status !== "ready"}
        className="btn btn-primary btn-block rounded-full px-8"
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
        servers.
      </p>
    </div>
  );
}
