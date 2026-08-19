"use client";

import { useActionState } from "react";

import { signIn } from "@/app/actions/staff";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-ink-subtle text-sm font-medium">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          autoFocus
          className="rounded-control border-border bg-surface text-ink border px-3 py-2"
        />
      </label>

      {state?.error ? (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-control bg-brand text-brand-ink hover:bg-brand-hover px-5 py-3 font-semibold transition-colors disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
