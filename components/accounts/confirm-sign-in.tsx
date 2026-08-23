"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { confirmSignIn } from "@/app/actions/sign-in";

/**
 * The token is only redeemed by this button's POST — never by rendering the
 * page. Mail scanners follow every GET in an email; if the page consumed on
 * load, the scanner would burn the single-use token before the customer saw it.
 */
export function ConfirmSignIn({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await confirmSignIn(formData);
        // On success the action redirects and never returns.
        setError(result.message);
      } catch (cause) {
        // Next implements redirect() by throwing; let it pass through.
        if (cause && typeof cause === "object" && "digest" in cause) throw cause;
        setError("Something went wrong. Check your connection and try again.");
      }
    });
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
        <Link href="/account/sign-in" className="btn btn-outline rounded-full">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col items-center gap-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={isPending} className="btn btn-primary rounded-full px-10">
        {isPending ? <span className="spinner" aria-hidden /> : null}
        {isPending ? "Signing you in…" : "Sign me in"}
      </button>
      <p className="text-ink-subtle text-xs">One tap and you&rsquo;re in — the link works once.</p>
    </form>
  );
}
