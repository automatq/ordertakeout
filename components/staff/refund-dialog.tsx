"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { refundNeedsPin, refundOrder } from "@/app/actions/refunds";
import { formatMoney } from "@/lib/square/money";

/**
 * Staff refund on a completed order — partial or full.
 *
 * Two-step by design (amount+reason, then an explicit confirm listing the
 * exact charge) because this moves real money with no undo in the app. The
 * PIN field appears only when the roster member actually has one.
 */
export function RefundButton({
  orderId,
  orderNumber,
  totalCents,
  refundedTotalCents,
  currency,
}: {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  refundedTotalCents: number;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const remaining = Math.max(0, totalCents - refundedTotalCents);
  if (remaining === 0) return <span className="tag">Fully refunded</span>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary btn-sm">
        Refund…
      </button>
      {open ? (
        <RefundDialog
          orderId={orderId}
          orderNumber={orderNumber}
          remainingCents={remaining}
          totalCents={totalCents}
          currency={currency}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function RefundDialog({
  orderId,
  orderNumber,
  remainingCents,
  totalCents,
  currency,
  onClose,
}: {
  orderId: string;
  orderNumber: string;
  remainingCents: number;
  totalCents: number;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((remainingCents / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [initials, setInitials] = useState("");
  const [pin, setPin] = useState("");
  const [needsPin, setNeedsPin] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const amountCents = Math.round(Number.parseFloat(amount || "0") * 100);
  const amountValid = Number.isInteger(amountCents) && amountCents >= 1 && amountCents <= remainingCents;

  const toConfirm = () => {
    setError(null);
    if (!amountValid) {
      setError(`Enter an amount up to ${formatMoney(remainingCents, currency)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("A short reason is required for every refund.");
      return;
    }
    if (!/^[A-Za-z]{2,6}$/.test(initials.trim())) {
      setError("Enter your 2–6 letter staff initials.");
      return;
    }
    startTransition(async () => {
      setNeedsPin(await refundNeedsPin(initials.trim()));
      setConfirming(true);
    });
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await refundOrder({
        orderId,
        amountCents,
        reason: reason.trim(),
        staffInitials: initials.trim(),
        ...(needsPin && pin ? { staffPin: pin } : {}),
      });
      if (!result.ok) {
        setError(result.reason);
        setConfirming(false);
        return;
      }
      if (result.notice) {
        setNotice(result.notice);
        router.refresh();
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-ink/50 p-0 sm:items-center sm:justify-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="refund-dialog-heading"
        className="bg-canvas shadow-raised flex max-h-[92dvh] w-full max-w-xl flex-col gap-5 overflow-y-auto rounded-t-[2rem] p-5 sm:rounded-[2rem] sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">Money back</p>
            <h2 id="refund-dialog-heading" className="font-display text-ink mt-1 text-3xl font-normal uppercase">
              Refund {orderNumber}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close refund dialog">
            Close
          </button>
        </div>

        {notice ? (
          <div className="card flex flex-col gap-3 p-5">
            <p className="text-ink">{notice}</p>
            <button type="button" onClick={onClose} className="btn btn-primary self-start">Done</button>
          </div>
        ) : confirming ? (
          <div className="card flex flex-col gap-3 p-5">
            <p className="text-ink text-lg">
              Refund <strong>{formatMoney(amountCents, currency)}</strong> of the{" "}
              {formatMoney(totalCents, currency)} charge?
            </p>
            <p className="text-ink-muted text-sm">
              Reason: {reason.trim()} · By: {initials.trim().toUpperCase()}. This goes back to the
              customer&rsquo;s card and cannot be undone here.
            </p>
            {needsPin ? (
              <div className="flex flex-col gap-1.5 sm:max-w-48">
                <label htmlFor="refund-pin" className="text-ink-subtle text-sm font-medium">Your 4-digit PIN</label>
                <input
                  id="refund-pin"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="off"
                  className="input"
                />
              </div>
            ) : null}
            {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={pending || (needsPin && pin.length !== 4)}
                onClick={submit}
                className="btn btn-primary"
              >
                {pending ? <span className="spinner" aria-hidden /> : null}
                Confirm refund
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="btn btn-secondary">
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="card flex flex-col gap-4 p-5">
            <p className="text-ink-muted text-sm">
              {refundedTotalLine(totalCents, remainingCents, currency)}
            </p>
            <div className="flex flex-col gap-1.5 sm:max-w-56">
              <label htmlFor="refund-amount" className="text-ink-subtle text-sm font-medium">
                Amount ({currency})
              </label>
              <input
                id="refund-amount"
                ref={firstFieldRef}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className="input"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="refund-reason" className="text-ink-subtle text-sm font-medium">Reason</label>
              <input
                id="refund-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={160}
                placeholder="Wrong item handed out"
                className="input"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:max-w-48">
              <label htmlFor="refund-initials" className="text-ink-subtle text-sm font-medium">Your initials</label>
              <input
                id="refund-initials"
                value={initials}
                onChange={(event) => setInitials(event.target.value)}
                maxLength={6}
                autoComplete="off"
                className="input"
              />
            </div>
            {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={pending} onClick={toConfirm} className="btn btn-primary">
                {pending ? <span className="spinner" aria-hidden /> : null}
                Continue
              </button>
              <button type="button" disabled={pending} onClick={onClose} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function refundedTotalLine(totalCents: number, remainingCents: number, currency: string): string {
  if (remainingCents === totalCents) {
    return `Nothing refunded yet. Up to ${formatMoney(remainingCents, currency)} can be returned.`;
  }
  return `${formatMoney(totalCents - remainingCents, currency)} of ${formatMoney(totalCents, currency)} already refunded — up to ${formatMoney(remainingCents, currency)} remains.`;
}
