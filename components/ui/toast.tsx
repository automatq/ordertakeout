"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * Transient feedback, app-wide.
 *
 * Before this, every confirmation in the app was an inline `<p>` rendered next
 * to the control that caused it: "Added." under a product form the customer had
 * already scrolled past, "Saved." under one of forty settings cards. None of
 * them dismissed, and re-triggering the same message didn't re-announce it
 * because the node never changed.
 *
 * A toast fixes all three: it renders in a fixed viewport, it clears itself,
 * and each one is a new node with a new key so assistive tech announces every
 * occurrence. The region is `role="status"` (polite) — nothing here is urgent
 * enough to interrupt, and errors that *are* urgent still get a `role="alert"`
 * next to the field they belong to.
 */

export type ToastTone = "success" | "error" | "info";

export type ToastOptions = {
  message: string;
  tone?: ToastTone;
  /** An optional inline affordance, e.g. Undo on a cart removal. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds on screen. Actionable toasts get longer by default. */
  duration?: number;
};

type Toast = ToastOptions & { id: number; tone: ToastTone };

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

/**
 * Returns a `toast(...)` function. Safe to call from a component rendered
 * outside the provider — it degrades to a no-op rather than throwing, so a
 * component can be reused in a context (a print sheet, a test) that has no
 * toast viewport.
 */
export function useToast() {
  const context = useContext(ToastContext);
  return context ?? noop;
}

function noop() {}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      const tone = options.tone ?? "success";
      setToasts((current) => [...current, { ...options, id, tone }]);

      const duration = options.duration ?? (options.action ? 8000 : 4500);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  // The provider wraps the whole tree, so a new object identity here would
  // re-render every consumer on each toast.
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone}>
            <p className="text-ink flex-1 text-sm text-pretty">{toast.message}</p>

            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
                className="text-brand hover:text-brand-hover shrink-0 text-sm font-medium underline underline-offset-2 transition-colors"
              >
                {toast.action.label}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="text-ink-subtle hover:text-ink -mt-1 -mr-1 shrink-0 rounded-full p-1 text-lg leading-none transition-colors"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
