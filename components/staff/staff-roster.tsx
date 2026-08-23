"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveStaffMemberAction, setStaffMemberActiveAction } from "@/app/actions/admin";
import { useToast } from "@/components/ui/toast";

export interface RosterMember {
  id: string;
  name: string;
  initials: string;
  hasPin: boolean;
  active: boolean;
}

/**
 * The staff roster — attribution, not accounts. Initials typed at pickup,
 * refunds, and settings changes are validated against this list. The optional
 * 4-digit PIN gates refunds only; it is honesty-hardening under the shared
 * password, not a security boundary, and the copy says so.
 */
export function StaffRoster({ members }: { members: RosterMember[] }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [pin, setPin] = useState("");
  const [pending, startTransition] = useTransition();

  const add = () => {
    startTransition(async () => {
      const result = await saveStaffMemberAction({
        name,
        initials,
        ...(pin ? { pin } : {}),
      });
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      toast({ message: `${name.trim()} added to the roster.` });
      setName("");
      setInitials("");
      setPin("");
      router.refresh();
    });
  };

  const setActive = (member: RosterMember, active: boolean) => {
    startTransition(async () => {
      const result = await setStaffMemberActiveAction({ id: member.id, active });
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      toast({ message: active ? `${member.name} reactivated.` : `${member.name} deactivated.` });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {members.length === 0 ? (
        <p className="panel text-ink-muted p-4 text-sm">
          No roster yet — any 2–6 letter initials are accepted at the counter until the first
          person is added here. Add everyone who verifies pickups or issues refunds.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li
              key={member.id}
              className={`panel flex flex-wrap items-center justify-between gap-3 p-3 text-sm ${member.active ? "" : "opacity-60"}`}
            >
              <div>
                <p className="text-ink font-semibold">
                  {member.name} <span className="text-ink-subtle">· {member.initials}</span>
                </p>
                <p className="text-ink-muted text-xs">
                  {member.hasPin ? "Refund PIN set" : "No refund PIN"}
                  {member.active ? "" : " · deactivated"}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => setActive(member, !member.active)}
                className="btn btn-secondary btn-sm shrink-0"
              >
                {member.active ? "Deactivate" : "Reactivate"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="card flex flex-col gap-3 p-4">
        <h3 className="text-ink font-semibold">Add a staff member</h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-subtle font-medium">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-subtle font-medium">Initials</span>
            <input
              value={initials}
              onChange={(event) => setInitials(event.target.value)}
              maxLength={6}
              className="input w-24"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-subtle font-medium">Refund PIN (optional, 4 digits)</span>
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              autoComplete="off"
              className="input w-28"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={pending || !name.trim() || initials.trim().length < 2}
          onClick={add}
          className="btn btn-primary btn-sm self-start"
        >
          {pending ? <span className="spinner" aria-hidden /> : null}
          Add to roster
        </button>
        <p className="text-ink-subtle text-xs">
          The PIN is asked for on refunds only. Attribution runs on the shared staff sign-in —
          it says who did something, not who could have.
        </p>
      </div>
    </div>
  );
}
