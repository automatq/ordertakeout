"use client";

import { useState } from "react";

import { STORE_INFO } from "@/lib/store";

/**
 * Newsletter sign-up.
 *
 * This used to be a bare `mailto:` link labelled "Subscribe" — on a phone that
 * either opens a mail app with an empty message or does nothing at all, and
 * either way the visitor has no idea whether they subscribed.
 *
 * The bakery has no mailing-list provider, so this can't be a silent POST: it
 * would have to either lie about what happened or drop the address. Instead the
 * field composes the email for them and the button says exactly what it does.
 * When an ESP is wired up, only `handleSubmit` changes — the markup, validation
 * and messaging all stay.
 */
export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = email.trim();
    // Deliberately loose. Anything stricter rejects real addresses, and the
    // authoritative check is the mail client refusing to send.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Enter an email address so we know where to write to.");
      return;
    }

    setError(null);
    setSent(true);
    window.location.href = `mailto:${STORE_INFO.email}?subject=${encodeURIComponent(
      "Subscribe me to the newsletter",
    )}&body=${encodeURIComponent(`Please add ${value} to the Harina Bakeshoppe newsletter.`)}`;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Your email address</span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              // Clearing on edit means the message never contradicts the field.
              if (error) setError(null);
            }}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "newsletter-error" : undefined}
            className="input bg-surface"
          />
        </label>

        <button type="submit" className="btn btn-accent shrink-0">
          Email us to subscribe
        </button>
      </div>

      {error ? (
        <p id="newsletter-error" role="alert" className="text-brand-ink text-sm">
          {error}
        </p>
      ) : null}

      {sent && !error ? (
        <p role="status" className="text-brand-ink text-sm opacity-90">
          Your email app should be opening with a message ready to send. If it
          didn&rsquo;t, write to {STORE_INFO.email}.
        </p>
      ) : null}
    </form>
  );
}
