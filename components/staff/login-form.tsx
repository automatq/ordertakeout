"use client";

import { useActionState, useState } from "react";

import { signIn } from "@/app/actions/staff";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";

/**
 * Staff sign-in form.
 *
 * The error used to be inserted into the flow between the field and the button,
 * so a failed attempt pushed the button down under the cursor that had just
 * pressed it. The message slot is reserved instead, and wired to the input with
 * `aria-describedby` + `aria-invalid` — which the other forms in the app already
 * did, and this one didn't.
 *
 * The reveal toggle is here because this is a shared password typed on a kitchen
 * tablet with a soft keyboard and, often, flour on the screen.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, {});
  const [revealed, setRevealed] = useState(false);

  const invalid = Boolean(state?.error);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="staff-password" className="text-ink-subtle text-sm font-medium">
          Password
        </label>

        <div className="relative">
          <input
            id="staff-password"
            type={revealed ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "staff-password-error" : undefined}
            className="input pr-12"
          />
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="text-ink-subtle hover:text-ink absolute inset-y-0 right-0 flex w-12 items-center justify-center transition-colors"
          >
            {revealed ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </button>
        </div>

        {/* Reserved height, so an error doesn't shove the button downwards. */}
        <div className="min-h-5">
          {state?.error ? (
            <p id="staff-password-error" role="alert" className="field-error">
              {state.error}
            </p>
          ) : null}
        </div>
      </div>

      <button type="submit" disabled={pending} className="btn btn-primary btn-block">
        {pending ? (
          <>
            <span className="spinner" aria-hidden />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
