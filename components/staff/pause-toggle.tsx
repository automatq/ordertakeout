"use client";

import { useState, useTransition } from "react";

import { setOrderingPauseAction } from "@/app/actions/admin";
import type { PauseOverview } from "@/lib/settings/pause";
import type { StoreLocation } from "@/lib/locations/types";
import { useToast } from "@/components/ui/toast";

/**
 * One-tap "stop taking orders" in the queue header — where staff already are
 * when the kitchen gets slammed, not buried in settings. Resuming is the same
 * tap. The optional auto-resume means nobody has to remember to turn ordering
 * back on after the rush.
 */
export function PauseToggle({
  overview,
  locations,
  onChanged,
}: {
  overview: PauseOverview;
  locations: StoreLocation[];
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>("global");
  const [note, setNote] = useState("");
  const [resume, setResume] = useState<string>("none");
  const [initials, setInitials] = useState("");
  const [pending, startTransition] = useTransition();

  const activePauses = [
    ...(isActive(overview.global) ? [{ id: "global", label: "All locations", setting: overview.global! }] : []),
    ...locations.flatMap((location) => {
      const setting = overview.byLocation[location.id];
      return isActive(setting) ? [{ id: location.id, label: location.name, setting: setting! }] : [];
    }),
  ];
  const anyPaused = activePauses.length > 0;

  const apply = (paused: boolean, applyScope: string) => {
    startTransition(async () => {
      const result = await setOrderingPauseAction({
        scope: applyScope === "global" ? "global" : { locationId: applyScope },
        paused,
        ...(paused && note.trim() ? { note: note.trim() } : {}),
        ...(paused && resume !== "none" ? { resumeMinutes: Number(resume) } : {}),
        ...(initials.trim() ? { staffInitials: initials.trim() } : {}),
      });
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      toast({ message: paused ? "Online ordering paused." : "Online ordering resumed." });
      setOpen(false);
      setNote("");
      await onChanged();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={`btn btn-sm ${anyPaused ? "btn-primary" : "btn-secondary"}`}
      >
        {anyPaused ? `Paused: ${activePauses.map((pause) => pause.label).join(", ")}` : "Pause ordering"}
      </button>

      {open ? (
        <div className="bg-canvas border-border shadow-raised absolute right-0 z-40 mt-2 flex w-80 flex-col gap-3 rounded-2xl border p-4">
          {anyPaused ? (
            <div className="flex flex-col gap-2">
              {activePauses.map((pause) => (
                <div key={pause.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-semibold">{pause.label}</p>
                    {pause.setting.note ? (
                      <p className="text-ink-muted truncate text-xs">{pause.setting.note}</p>
                    ) : null}
                    {pause.setting.resumeAt ? (
                      <p className="text-ink-subtle text-xs">
                        Auto-resumes {new Date(pause.setting.resumeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => apply(false, pause.id)}
                    className="btn btn-primary btn-sm shrink-0"
                  >
                    Resume
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pause-scope" className="text-ink-subtle text-xs font-medium">Where</label>
                <select id="pause-scope" value={scope} onChange={(event) => setScope(event.target.value)} className="input py-1.5 text-sm">
                  <option value="global">All locations</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pause-note" className="text-ink-subtle text-xs font-medium">
                  Customer message (optional)
                </label>
                <input
                  id="pause-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={200}
                  placeholder="Back at 3 PM — big catering push"
                  className="input py-1.5 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pause-resume" className="text-ink-subtle text-xs font-medium">Auto-resume</label>
                <select id="pause-resume" value={resume} onChange={(event) => setResume(event.target.value)} className="input py-1.5 text-sm">
                  <option value="none">When we resume manually</option>
                  <option value="30">In 30 minutes</option>
                  <option value="60">In 1 hour</option>
                  <option value="120">In 2 hours</option>
                  <option value="240">In 4 hours</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pause-initials" className="text-ink-subtle text-xs font-medium">Your initials (optional)</label>
                <input
                  id="pause-initials"
                  value={initials}
                  onChange={(event) => setInitials(event.target.value)}
                  maxLength={6}
                  className="input py-1.5 text-sm"
                />
              </div>
              <button type="button" disabled={pending} onClick={() => apply(true, scope)} className="btn btn-primary btn-sm">
                {pending ? <span className="spinner" aria-hidden /> : null}
                Pause ordering
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function isActive(setting: PauseOverview["global"] | undefined): boolean {
  if (!setting?.paused) return false;
  if (setting.resumeAt && new Date(setting.resumeAt).getTime() <= Date.now()) return false;
  return true;
}
