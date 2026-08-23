"use client";

import { useState, useTransition } from "react";

import { resendOrderConfirmation } from "@/app/actions/staff";
import { useToast } from "@/components/ui/toast";

/** "The customer says they never got the email" — answerable with one tap. */
export function ResendEmailButton({ orderId }: { orderId: string }) {
  const toast = useToast();
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending || sent}
      onClick={() =>
        startTransition(async () => {
          const result = await resendOrderConfirmation({ orderId });
          if (!result.ok) {
            toast({ message: result.reason, tone: "error" });
            return;
          }
          setSent(true);
          toast({ message: "Confirmation email re-sent." });
        })
      }
      className="btn btn-ghost btn-sm"
    >
      {pending ? <span className="spinner" aria-hidden /> : null}
      {sent ? "Email re-sent" : "Re-send email"}
    </button>
  );
}
