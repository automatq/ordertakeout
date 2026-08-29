"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveNotificationRecipientsAction } from "@/app/actions/admin";
import type { NotificationRecipients } from "@/lib/settings/notifications";
import type { StoreLocation } from "@/lib/locations/types";
import { useToast } from "@/components/ui/toast";

/**
 * Where order alerts go — editable without a redeploy at last. Recipients only:
 * the provider API keys stay in environment variables, and the read-only
 * indicators say which providers are wired so an empty inbox is explainable.
 */
export function NotificationSettings({
  initial,
  locations,
  providers,
}: {
  initial: NotificationRecipients;
  locations: StoreLocation[];
  providers: { email: boolean; sms: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const [storeEmails, setStoreEmails] = useState(initial.storeEmails.join(", "));
  const [storePhone, setStorePhone] = useState(initial.storePhone ?? "");
  const [locationEmails, setLocationEmails] = useState<Record<string, string>>(
    Object.fromEntries(locations.map((location) => [location.id, initial.locationEmails[location.id] ?? ""])),
  );
  const [locationPhones, setLocationPhones] = useState<Record<string, string>>(
    Object.fromEntries(locations.map((location) => [location.id, initial.locationPhones[location.id] ?? ""])),
  );
  const [useEnvFallback, setUseEnvFallback] = useState(initial.useEnvFallback);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await saveNotificationRecipientsAction({
        useEnvFallback,
        storeEmails: storeEmails
          .split(",")
          .map((email) => email.trim())
          .filter(Boolean),
        storePhone: storePhone.trim() || null,
        locationEmails: Object.fromEntries(
          Object.entries(locationEmails).flatMap(([id, email]) =>
            email.trim() ? [[id, email.trim()]] : [],
          ),
        ),
        locationPhones: Object.fromEntries(
          Object.entries(locationPhones).flatMap(([id, phone]) =>
            phone.trim() ? [[id, phone.trim()]] : [],
          ),
        ),
      });
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      toast({ message: "Notification recipients saved. They apply from the next order." });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className={`tag ${providers.email ? "" : "opacity-60"}`}>
          Email provider: {providers.email ? "configured" : "not configured (env)"}
        </span>
        <span className={`tag ${providers.sms ? "" : "opacity-60"}`}>
          SMS provider: {providers.sms ? "configured" : "not configured (env)"}
        </span>
      </div>

      <div className="card flex flex-col gap-4 p-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-ink-subtle font-medium">Store email(s) — comma separated, up to 5</span>
          <input
            value={storeEmails}
            onChange={(event) => setStoreEmails(event.target.value)}
            placeholder="orders@bakery.com, owner@bakery.com"
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:max-w-64">
          <span className="text-ink-subtle font-medium">Store SMS number</span>
          <input
            value={storePhone}
            onChange={(event) => setStorePhone(event.target.value)}
            placeholder="+1 416 555 0142"
            className="input"
          />
        </label>

        {locations.length > 1 ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink-subtle text-sm font-medium">
              Per-location overrides (used instead of the store defaults for that branch&rsquo;s orders)
            </p>
            {locations.map((location) => (
              <div key={location.id} className="flex flex-wrap gap-3">
                <span className="text-ink w-full text-sm font-semibold sm:w-40">{location.name}</span>
                <input
                  aria-label={`${location.name} email`}
                  value={locationEmails[location.id] ?? ""}
                  onChange={(event) =>
                    setLocationEmails((current) => ({ ...current, [location.id]: event.target.value }))
                  }
                  placeholder="Email"
                  className="input flex-1"
                />
                <input
                  aria-label={`${location.name} SMS number`}
                  value={locationPhones[location.id] ?? ""}
                  onChange={(event) =>
                    setLocationPhones((current) => ({ ...current, [location.id]: event.target.value }))
                  }
                  placeholder="SMS number"
                  className="input w-44"
                />
              </div>
            ))}
          </div>
        ) : null}

        <label className="text-ink flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useEnvFallback}
            onChange={(event) => setUseEnvFallback(event.target.checked)}
          />
          Fall back to the deployment&rsquo;s configured defaults when a field above is empty
        </label>
        <p className="text-ink-subtle text-xs">
          Unchecked with empty fields means deliberately silent — no store alerts at all.
          Customers still get their own confirmation emails either way.
        </p>

        <button type="button" disabled={pending} onClick={save} className="btn btn-primary btn-sm self-start">
          {pending ? <span className="spinner" aria-hidden /> : null}
          Save recipients
        </button>
      </div>
    </div>
  );
}
