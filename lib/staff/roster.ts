import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { staffMembers } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";

/**
 * The staff roster — attribution, not authentication.
 *
 * The shared dashboard password stays; this validates that initials typed on
 * pickup verification, refunds, and settings changes belong to a real person.
 * Two deliberate softness rules:
 * - An EMPTY active roster accepts any well-formed initials, so day one (and a
 *   fully-deactivated roster) never locks the counter.
 * - Members are deactivated, never deleted — historical attribution keeps
 *   meaning.
 * The optional 4-digit PIN gates refunds only. It hardens attribution against
 * casual impersonation; it is not a security boundary (the shared session
 * already grants everything) and the code must never pretend otherwise.
 */

export function normalizeInitials(value: string): string | null {
  const initials = value.trim().toUpperCase();
  return /^[A-Z]{2,6}$/.test(initials) ? initials : null;
}

export async function listStaffMembers() {
  return db()
    .select({
      id: staffMembers.id,
      name: staffMembers.name,
      initials: staffMembers.initials,
      hasPin: staffMembers.pinHash,
      active: staffMembers.active,
      createdAt: staffMembers.createdAt,
    })
    .from(staffMembers)
    .orderBy(desc(staffMembers.active), asc(staffMembers.name))
    .then((rows) => rows.map((row) => ({ ...row, hasPin: row.hasPin !== null })));
}

export type InitialsValidation =
  | { ok: true; memberId: string | null }
  | { ok: false; message: string };

export async function validateInitials(value: string): Promise<InitialsValidation> {
  const initials = normalizeInitials(value);
  if (!initials) return { ok: false, message: "Initials must be 2–6 letters." };

  const active = await db()
    .select({ id: staffMembers.id, initials: staffMembers.initials })
    .from(staffMembers)
    .where(eq(staffMembers.active, true));

  // Bootstrap rule: with no active roster there is nothing to check against.
  if (active.length === 0) return { ok: true, memberId: null };

  const member = active.find((candidate) => candidate.initials === initials);
  if (!member) {
    return {
      ok: false,
      message: "These initials aren't on the staff roster. Ask a manager to add you under Settings → Staff.",
    };
  }
  return { ok: true, memberId: member.id };
}

/** Keyed hash so a database dump alone can't be brute-forced offline in seconds. */
function hashPin(pin: string): string {
  const key = serverEnv().ORDER_ACCESS_SECRET ?? serverEnv().STAFF_DASHBOARD_PASSWORD;
  return createHmac("sha256", `staff-pin:${key}`).update(pin).digest("base64url");
}

export interface SaveStaffMemberInput {
  id?: string;
  name: string;
  initials: string;
  /** undefined = leave unchanged; null = clear; string = set. */
  pin?: string | null;
  active?: boolean;
}

export type SaveStaffMemberResult = { ok: true; id: string } | { ok: false; message: string };

export async function saveStaffMember(input: SaveStaffMemberInput): Promise<SaveStaffMemberResult> {
  const initials = normalizeInitials(input.initials);
  if (!initials) return { ok: false, message: "Initials must be 2–6 letters." };
  const name = input.name.trim();
  if (!name) return { ok: false, message: "A name is required." };
  if (input.pin != null && !/^\d{4}$/.test(input.pin)) {
    return { ok: false, message: "The PIN must be exactly 4 digits." };
  }

  const pinUpdate =
    input.pin === undefined ? {} : { pinHash: input.pin === null ? null : hashPin(input.pin) };

  try {
    if (input.id) {
      const [updated] = await db()
        .update(staffMembers)
        .set({
          name,
          initials,
          active: input.active ?? true,
          ...pinUpdate,
          updatedAt: new Date(),
        })
        .where(eq(staffMembers.id, input.id))
        .returning({ id: staffMembers.id });
      return updated ? { ok: true, id: updated.id } : { ok: false, message: "That staff member no longer exists." };
    }
    const [created] = await db()
      .insert(staffMembers)
      .values({ name, initials, active: input.active ?? true, ...pinUpdate })
      .returning({ id: staffMembers.id });
    if (!created) return { ok: false, message: "Could not save the staff member." };
    return { ok: true, id: created.id };
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return { ok: false, message: `The initials ${initials} are already taken.` };
    }
    throw cause;
  }
}

export async function setStaffMemberActive(id: string, active: boolean): Promise<void> {
  await db()
    .update(staffMembers)
    .set({ active, updatedAt: new Date() })
    .where(eq(staffMembers.id, id));
}

/** True when the member exists, is active, has a PIN, and it matches. */
export async function verifyStaffPin(initialsValue: string, pin: string): Promise<boolean> {
  const initials = normalizeInitials(initialsValue);
  if (!initials || !/^\d{4}$/.test(pin)) return false;
  const [member] = await db()
    .select({ pinHash: staffMembers.pinHash })
    .from(staffMembers)
    .where(eq(staffMembers.initials, initials))
    .limit(1);
  if (!member?.pinHash) return false;
  const expected = Buffer.from(member.pinHash);
  const received = Buffer.from(hashPin(pin));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** True when any active member has a PIN — refund UI asks for one only then. */
export async function rosterRequiresPin(initialsValue: string): Promise<boolean> {
  const initials = normalizeInitials(initialsValue);
  if (!initials) return false;
  const [member] = await db()
    .select({ pinHash: staffMembers.pinHash, active: staffMembers.active })
    .from(staffMembers)
    .where(eq(staffMembers.initials, initials))
    .limit(1);
  return Boolean(member?.active && member.pinHash);
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: string }).code === "23505"
  );
}
