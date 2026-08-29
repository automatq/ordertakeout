"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createProfileFromPhone } from "@/app/actions/account";
import { ProfileFields } from "@/components/accounts/profile-fields";

/**
 * Finish sign-up for a number that has just answered a texted code.
 *
 * The number is not submitted — it is read from the signed cookie set when the
 * code was verified. It is rendered read-only so the customer can see which
 * number they are registering.
 */
export function SignUpForm({ phone }: { phone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      action={(formData) =>
        startTransition(async () => {
          setMessage(null);
          const result = await createProfileFromPhone({
            name: formData.get("name"),
            email: formData.get("email"),
            phone,
          });
          if (!result.ok) return setMessage(result.message);
          /* The action has written the session cookie; refresh so the server
             components re-render signed in, then move to the account page. */
          router.refresh();
          router.push("/account");
        })
      }
    >
      <ProfileFields
        defaults={{ name: "", email: "", phone }}
        disabled={pending}
        phoneReadOnly
      />

      <button type="submit" className="btn btn-primary rounded-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create my account"}
      </button>

      {message ? (
        <p role="alert" className="text-danger text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
