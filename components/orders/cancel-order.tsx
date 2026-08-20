"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelCustomerOrder } from "@/app/actions/orders";
import { formatMoney } from "@/lib/square/money";

export function CancelOrder({
  orderNumber,
  accessToken,
  totalCents,
  currency,
}: {
  orderNumber: string;
  accessToken: string;
  totalCents: number;
  currency: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn btn-danger btn-sm self-start rounded-full"
      >
        Cancel order
      </button>
    );
  }

  return (
    <div className="panel border-danger/30 flex flex-col gap-3 rounded-[1.25rem] p-4">
      <p className="text-ink text-sm">
        Cancel this order and refund {formatMoney(totalCents, currency)} to the original card?
      </p>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await cancelCustomerOrder({ orderNumber, accessToken });
            if (!result.ok) {
              setError(result.reason);
              return;
            }
            router.refresh();
          })}
          className="btn btn-danger btn-sm rounded-full"
        >
          {pending ? <span className="spinner" aria-hidden /> : null}
          Yes, cancel and refund
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="btn btn-secondary btn-sm rounded-full"
        >
          Keep my order
        </button>
      </div>
    </div>
  );
}
