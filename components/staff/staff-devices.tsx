"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { revokeStaffDeviceAction } from "@/app/actions/admin";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { PhoneIcon } from "@/components/ui/icons";

export interface StaffDeviceView {
  id: string;
  label: string;
  platform: string | null;
  lastSeen: string;
  addedOn: string;
  revoked: boolean;
}

/**
 * Phones and tablets signed in to the staff app.
 *
 * This screen is the answer to "someone left and took the tablet". Before it,
 * the only way to end a staff session was to change the shared password, which
 * signs out every counter tablet mid-shift — so in practice nobody did, and a
 * missing device kept working.
 *
 * Revoked rows stay listed rather than disappearing. "This tablet was cut off
 * three weeks ago" is a useful thing to be able to see; a device silently
 * vanishing from a list is not.
 */
export function StaffDevices({ devices }: { devices: StaffDeviceView[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-lg font-semibold">Signed-in devices</h2>
        <p className="text-ink-muted text-sm">
          Every phone or tablet using the staff app. Signing one out stops it immediately
          and leaves the others alone — nobody else has to sign back in.
        </p>
      </div>

      {devices.length === 0 ? (
        <EmptyState
          compact
          icon={<PhoneIcon className="h-5 w-5" />}
          title="No devices yet"
          description="They appear here the first time someone signs in to the staff app."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DeviceRow({ device }: { device: StaffDeviceView }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const toast = useToast();

  function revoke() {
    startTransition(async () => {
      const result = await revokeStaffDeviceAction({ deviceId: device.id });
      if (result.ok) {
        toast({ message: `${device.label} was signed out.` });
        router.refresh();
      } else {
        toast({ tone: "error", message: result.error });
      }
      setConfirming(false);
    });
  }

  return (
    <li className="card flex flex-wrap items-center gap-3 p-5">
      <div className="min-w-40 flex-1">
        <p className="text-ink text-sm font-medium">
          {device.label}
          {device.platform ? (
            <span className="text-ink-subtle font-normal"> · {device.platform}</span>
          ) : null}
        </p>
        <p className="text-ink-muted text-sm">
          {device.revoked
            ? `Signed out — added ${device.addedOn}`
            : `Last used ${device.lastSeen} · added ${device.addedOn}`}
        </p>
      </div>

      {device.revoked ? (
        <span className="badge">Signed out</span>
      ) : confirming ? (
        <div className="flex items-center gap-2">
          {/* Irreversible from the shop's side — that handset has to be signed
              in again by hand — so it asks once rather than acting on a tap. */}
          <span className="text-ink-muted text-sm">Sign this device out?</span>
          <button
            type="button"
            onClick={revoke}
            disabled={isPending}
            className="btn btn-danger btn-sm"
          >
            {isPending ? <span className="spinner" aria-hidden /> : null}
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="btn btn-ghost btn-sm"
          >
            Keep
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="btn btn-ghost btn-sm">
          Sign out
        </button>
      )}
    </li>
  );
}
