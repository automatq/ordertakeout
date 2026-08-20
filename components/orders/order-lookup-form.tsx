"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { findOrder, type LookupResult } from "@/app/actions/orders";
import { SearchIcon } from "@/components/ui/icons";

/**
 * "Where's my order?" form.
 *
 * A plain server action with `useActionState` rather than a controlled form:
 * there's no client-side validation worth doing here (the number either matches
 * an order or it doesn't), so the browser's own `required` handles the empty
 * case and the server handles everything else.
 */
export function OrderLookupForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LookupResult | null, FormData>(
    findOrder,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.push(`/orders/${state.orderNumber}?key=${encodeURIComponent(state.accessToken)}`);
  }, [state, router]);

  return (
    <form action={formAction} className="card flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="lookup-number" className="text-ink-subtle text-sm font-medium">
          Order number
        </label>
        <input
          id="lookup-number"
          name="orderNumber"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="e.g. HB-4K7QX2"
          aria-describedby="lookup-number-hint"
          className="input"
        />
        <span id="lookup-number-hint" className="field-hint">
          It&rsquo;s at the top of your confirmation email.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lookup-email" className="text-ink-subtle text-sm font-medium">
          Email address
        </label>
        <input
          id="lookup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="input"
        />
      </div>

      {state && !state.ok ? (
        <p role="alert" className="field-error">
          {state.message}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn-primary btn-block sm:w-auto">
        {pending ? (
          <>
            <span className="spinner" aria-hidden />
            Looking…
          </>
        ) : (
          <>
            <SearchIcon className="h-4 w-4" />
            Find my order
          </>
        )}
      </button>
    </form>
  );
}
