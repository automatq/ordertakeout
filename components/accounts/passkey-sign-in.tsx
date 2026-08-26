"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";

import { completePasskeySignIn, startPasskeySignIn } from "@/app/actions/passkeys";
import { FingerprintIcon } from "@/components/ui/icons";

/**
 * One-tap sign-in with Face ID, Touch ID, Windows Hello or a hardware key.
 *
 * Rendered above the email and SMS options because it is strictly better than
 * both when it is available: nothing to type, nothing to wait for in an inbox,
 * no message to pay Twilio for, and it cannot be phished — the browser will not
 * release the credential to a lookalike domain.
 *
 * Hidden entirely where the browser has no WebAuthn support, rather than shown
 * and then failing, since the other two methods are right there.
 */
export function PasskeySignIn() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /* Support is a browser capability, so the server has no answer for it. Read
     it as an external store rather than in an effect: the server snapshot is
     false, the client's is the real value, and React reconciles the difference
     itself instead of us hydrating one thing and immediately setting another. */
  const supported = useSyncExternalStore(
    () => () => {},
    () => browserSupportsWebAuthn(),
    () => false,
  );

  if (!supported) return null;

  function handleSignIn() {
    setError(null);
    startTransition(async () => {
      try {
        const options = await startPasskeySignIn();
        if (!options) {
          setError("Passkey sign-in isn't available right now. Use email or a text instead.");
          return;
        }

        const response = await startAuthentication({ optionsJSON: options });
        // Succeeds by redirecting, so anything returned here is a failure.
        const result = await completePasskeySignIn(response);
        setError(result.message);
      } catch (cause) {
        /* Cancelling the system prompt is a normal thing to do, not an error
           worth shouting about — the customer simply changed their mind. */
        const name = cause instanceof Error ? cause.name : "";
        if (name === "NotAllowedError" || name === "AbortError") return;
        setError("That didn't work. Try email or a text instead.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isPending}
        className="btn btn-primary rounded-full"
      >
        {isPending ? <span className="spinner" aria-hidden /> : <FingerprintIcon className="h-4 w-4" />}
        {isPending ? "Waiting for your device…" : "Sign in with a passkey"}
      </button>

      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}

      <p className="text-ink-subtle text-center text-xs">
        Uses Face ID, Touch ID or your device passcode. Nothing to type.
      </p>
    </div>
  );
}
