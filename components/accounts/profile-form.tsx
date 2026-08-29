"use client";

import { useState, useTransition } from "react";

import { updateProfile } from "@/app/actions/account";
import { ProfileFields } from "@/components/accounts/profile-fields";
import type { CustomerProfile } from "@/lib/accounts/profile";

/**
 * Edit the details checkout fills itself in with.
 *
 * These were write-once until now: whatever was typed at the first saved
 * checkout followed the customer forever, and a mistyped email quietly meant no
 * confirmations. Changing the email moves the account's identity, so the server
 * refuses an address that already belongs to somebody else.
 */
export function ProfileForm({ profile }: { profile: CustomerProfile }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState(profile);

  return (
    <section className="card rounded-[2rem] p-6" aria-labelledby="profile-heading">
      <p className="text-brand text-xs font-semibold tracking-[0.14em] uppercase">Your details</p>
      <h2 id="profile-heading" className="font-display text-ink mt-1 text-3xl font-normal uppercase">
        Profile
      </h2>
      <p className="text-ink-muted mt-2 text-sm">
        We fill these in for you at checkout. Change them here and the next order follows.
      </p>

      <form
        className="mt-5 flex flex-col gap-4"
        action={(formData) =>
          startTransition(async () => {
            setMessage(null);
            const result = await updateProfile({
              name: formData.get("name"),
              email: formData.get("email"),
              phone: formData.get("phone"),
              smsOptIn: formData.get("smsOptIn") === "on",
            });
            if (result.ok) {
              setCurrent(result.profile);
              setMessage({ ok: true, text: "Saved." });
            } else {
              setMessage({ ok: false, text: result.message });
            }
          })
        }
      >
        <ProfileFields
          key={`${current.name}:${current.email}:${current.phone}`}
          defaults={current}
          disabled={pending}
        />

        <label className="text-ink-muted flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="smsOptIn"
            defaultChecked={current.smsOptIn}
            disabled={pending}
            className="mt-0.5 size-4 accent-current"
          />
          <span>
            Text me about my orders.{" "}
            <span className="text-ink-subtle">
              Order updates only — never marketing. You confirm this per order at checkout too.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary rounded-full" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          {message ? (
            <p
              role={message.ok ? "status" : "alert"}
              className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
