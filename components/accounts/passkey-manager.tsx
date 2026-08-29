"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";

import {
  completePasskeyRegistration,
  removePasskey,
  startPasskeyRegistration,
} from "@/app/actions/passkeys";
import { FingerprintIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

export interface PasskeyRow {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Enrol and revoke passkeys.
 *
 * Only reachable from the signed-in account page: a passkey is a second way
 * into an account that already exists, never a way to create one, so the
 * customer has already proved themselves with a link or a code before getting
 * here.
 */
export function PasskeyManager({ passkeys }: { passkeys: PasskeyRow[] }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const supported = useSyncExternalStore(
    () => () => {},
    () => browserSupportsWebAuthn(),
    () => false,
  );

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      try {
        const options = await startPasskeyRegistration();
        if (!options) {
          setError("Passkeys aren't available right now. Try again later.");
          return;
        }

        const response = await startRegistration({ optionsJSON: options });
        const result = await completePasskeyRegistration(response, describeDevice());
        if (result.ok) {
          toast({ message: "Passkey added. You can use it to sign in next time." });
          router.refresh();
        } else {
          setError(result.message);
        }
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : "";
        // Cancelling the system prompt is a choice, not a failure.
        if (name === "NotAllowedError" || name === "AbortError") return;
        // The browser refuses a duplicate for an authenticator already enrolled.
        if (name === "InvalidStateError") {
          setError("This device already has a passkey for your account.");
          return;
        }
        setError("We couldn't add that passkey. Try again.");
      }
    });
  }

  function handleRemove(id: string) {
    startTransition(async () => {
      const result = await removePasskey(id);
      if (result.ok) {
        toast({ message: "Passkey removed." });
        router.refresh();
      } else {
        toast({ tone: "error", message: result.message });
      }
    });
  }

  if (!supported && passkeys.length === 0) return null;

  return (
    <section className="card flex flex-col gap-4 rounded-[2rem] p-6" aria-labelledby="passkeys-heading">
      <div>
        <p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">Sign-in</p>
        <h2 id="passkeys-heading" className="font-display mt-1 text-3xl uppercase">
          Passkeys
        </h2>
        <p className="text-ink-muted mt-2 text-sm">
          Sign in with Face ID, Touch ID or your device passcode instead of waiting for an
          email or a text.
        </p>
      </div>

      {passkeys.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border p-4"
            >
              <span className="flex items-center gap-3">
                <FingerprintIcon className="text-brand h-4 w-4 shrink-0" />
                <span>
                  <span className="text-ink block font-medium">
                    {passkey.deviceLabel ?? "Passkey"}
                  </span>
                  <span className="text-ink-subtle text-sm">
                    {passkey.lastUsedAt
                      ? `Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`
                      : "Not used yet"}
                  </span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => handleRemove(passkey.id)}
                disabled={isPending}
                className="btn btn-ghost btn-sm rounded-full"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}

      {supported ? (
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending}
          className="btn btn-outline btn-sm self-start rounded-full"
        >
          {isPending ? <span className="spinner" aria-hidden /> : null}
          {passkeys.length > 0 ? "Add another passkey" : "Add a passkey"}
        </button>
      ) : (
        <p className="text-ink-subtle text-sm">
          This browser doesn&rsquo;t support passkeys, so they can only be managed here.
        </p>
      )}
    </section>
  );
}

/** A readable label for the revoke list. Best-effort — it only has to be recognisable. */
function describeDevice(): string {
  const ua = navigator.userAgent;
  const platform =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : "This device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  return browser ? `${platform} · ${browser}` : platform;
}
