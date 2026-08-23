"use client";

import { useState, useTransition } from "react";

import { requestSignInLink, type SignInRequestResult } from "@/app/actions/sign-in";

export function SignInForm() {
  const [result, setResult] = useState<SignInRequestResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        setResult(await requestSignInLink(formData));
      } catch {
        setResult({ ok: false, message: "Something went wrong. Check your connection and try again." });
      }
    });
  }

  if (result?.ok) {
    return (
      <div role="status" className="bg-success-soft text-ink rounded-[1.25rem] p-5 text-sm leading-relaxed">
        <p className="font-medium">Check your inbox</p>
        <p className="text-ink-muted mt-1">{result.message}</p>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-ink text-sm font-medium">Email address</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="input"
        />
      </label>

      {result && !result.ok ? (
        <p role="alert" className="field-error">
          {result.message}
        </p>
      ) : null}

      <button type="submit" disabled={isPending} className="btn btn-primary rounded-full">
        {isPending ? <span className="spinner" aria-hidden /> : null}
        {isPending ? "Sending…" : "Email me a sign-in link"}
      </button>

      <p className="text-ink-subtle text-xs">
        No passwords — we email you a link that works once and expires in 15 minutes.
      </p>
    </form>
  );
}
