"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { PasskeySignIn } from "@/components/accounts/passkey-sign-in";
import {
  requestPhoneSignInCode,
  requestSignInLink,
  verifyPhoneSignInCode,
  type SignInRequestResult,
} from "@/app/actions/sign-in";

type Method = "phone" | "email";

/**
 * Sign-in, phone first.
 *
 * Texting a code is the default because a magic link tapped inside a mail app
 * frequently opens in an in-app browser rather than the one the customer
 * started in, and the session lands where they aren't. A code typed — or
 * autofilled — into this tab cannot miss. Email stays one tap away: it costs
 * nothing to send, it is the durable identity, and it is the fallback when a
 * number is shared by two accounts.
 */
export function SignInForm() {
  const [method, setMethod] = useState<Method>("phone");

  return (
    <div className="flex flex-col gap-5">
      {/* Above the tabs, not inside them: where a passkey exists it beats both
          alternatives outright, and burying it as a third tab would hide the
          fastest route behind a click. */}
      <PasskeySignIn />

      <div className="flex items-center gap-3" aria-hidden>
        <span className="border-border flex-1 border-t" />
        <span className="text-ink-subtle text-xs uppercase tracking-[0.14em]">or</span>
        <span className="border-border flex-1 border-t" />
      </div>

      <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-2">
        <MethodTab id="phone" current={method} onSelect={setMethod} label="Text me a code" />
        <MethodTab id="email" current={method} onSelect={setMethod} label="Email me a link" />
      </div>

      <div
        role="tabpanel"
        id="signin-panel-phone"
        aria-labelledby="signin-tab-phone"
        hidden={method !== "phone"}
      >
        {method === "phone" ? <PhoneSignIn /> : null}
      </div>

      <div
        role="tabpanel"
        id="signin-panel-email"
        aria-labelledby="signin-tab-email"
        hidden={method !== "email"}
      >
        {method === "email" ? <EmailSignIn /> : null}
      </div>
    </div>
  );
}

function MethodTab({
  id,
  current,
  onSelect,
  label,
}: {
  id: Method;
  current: Method;
  onSelect: (method: Method) => void;
  label: string;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      id={`signin-tab-${id}`}
      aria-selected={selected}
      aria-controls={`signin-panel-${id}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(id)}
      className={`btn btn-sm rounded-full ${selected ? "btn-primary" : "btn-outline"}`}
    >
      {label}
    </button>
  );
}

function PhoneSignIn() {
  const [phase, setPhase] = useState<"request" | "verify">("request");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<SignInRequestResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  // Move the caret to the code box so an autofilled SMS suggestion has a target.
  useEffect(() => {
    if (phase === "verify") codeRef.current?.focus();
  }, [phase]);

  function handleRequest(formData: FormData) {
    startTransition(async () => {
      try {
        const next = await requestPhoneSignInCode(formData);
        setResult(next);
        if (next.ok) {
          setPhone(String(formData.get("phone") ?? ""));
          setPhase("verify");
        }
      } catch {
        setResult({ ok: false, message: "Something went wrong. Check your connection and try again." });
      }
    });
  }

  function handleVerify(formData: FormData) {
    startTransition(async () => {
      try {
        // On success this redirects and never returns.
        setResult(await verifyPhoneSignInCode(formData));
      } catch {
        setResult({ ok: false, message: "Something went wrong. Check your connection and try again." });
      }
    });
  }

  if (phase === "verify") {
    return (
      <form action={handleVerify} className="flex flex-col gap-3">
        <input type="hidden" name="phone" value={phone} />

        <div role="status" className="bg-success-soft text-ink rounded-[1.25rem] p-4 text-sm">
          <p className="font-medium">Check your texts</p>
          <p className="text-ink-muted mt-1">{result?.message}</p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-ink text-sm font-medium">6-digit code</span>
          <input
            ref={codeRef}
            type="text"
            name="code"
            required
            /* The pair that makes iOS and Android offer the code above the
               keyboard — the whole reason this beats a magic link on a phone. */
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            className="input text-center text-2xl tracking-[0.4em]"
          />
        </label>

        {result && !result.ok ? (
          <p role="alert" className="field-error">
            {result.message}
          </p>
        ) : null}

        <button type="submit" disabled={isPending} className="btn btn-primary rounded-full">
          {isPending ? <span className="spinner" aria-hidden /> : null}
          {isPending ? "Checking…" : "Sign me in"}
        </button>

        <button
          type="button"
          onClick={() => {
            setPhase("request");
            setResult(null);
          }}
          className="btn btn-ghost btn-sm rounded-full"
        >
          Use a different number
        </button>
      </form>
    );
  }

  return (
    <form action={handleRequest} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-ink text-sm font-medium">Mobile number</span>
        <input
          type="tel"
          name="phone"
          required
          autoComplete="tel"
          inputMode="tel"
          placeholder="(416) 555-0142"
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
        {isPending ? "Sending…" : "Text me a code"}
      </button>

      <p className="text-ink-subtle text-xs">
        No passwords — we text a 6-digit code that works once and expires in 10 minutes.
        Standard message rates apply.
      </p>
    </form>
  );
}

function EmailSignIn() {
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
