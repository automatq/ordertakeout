"use client";

import { useState, useTransition } from "react";

import { claimCustomerAccount } from "@/app/actions/account";

export function CreateAccount({ orderNumber, accessToken }: { orderNumber: string; accessToken: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section className="bg-secondary text-secondary-ink flex flex-col gap-3 rounded-[1.5rem] p-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="account-heading">
      <div>
        <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">Regular customer?</p>
        <h2 id="account-heading" className="font-display text-2xl font-normal uppercase">Save this order and earn rewards</h2>
        <p className="text-secondary-ink/80 mt-1 text-sm">No password needed. We’ll save your details and give you one point per dollar after verified pickup.</p>
      </div>
      <div className="shrink-0">
        <button type="button" className="btn btn-primary rounded-full" disabled={pending} onClick={() => startTransition(async () => {
          const result = await claimCustomerAccount({ orderNumber, accessToken });
          setMessage(result.ok ? "Your account is ready. Visit My account to see your rewards." : result.message);
        })}>
          {pending ? "Saving…" : "Save my account"}
        </button>
        {message ? <p role="status" className="mt-2 max-w-xs text-sm">{message}</p> : null}
      </div>
    </section>
  );
}
