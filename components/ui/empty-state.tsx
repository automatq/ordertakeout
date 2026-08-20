import Link from "next/link";

/**
 * The house empty state.
 *
 * There were nine of these in the app and every one was a bare sentence in a
 * `<p>` — "Your order is empty.", "Nothing closed yet.", "Nothing to bake for
 * this day." No container, no glyph, and usually no way out. An empty screen is
 * a screen where the customer or staff member most needs to be told what to do
 * next, so the action slot here is the point of the component.
 *
 * `role="status"` on the container means an empty result that appears after a
 * filter or a fetch is announced, not silently rendered.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** A primary way out. Internal links use next/link; external ones an <a>. */
  action?: { label: string; href: string };
  /** For anything the action slot can't express (a form, two buttons). */
  children?: React.ReactNode;
  /** Tighter padding, for empty states nested inside a card or a lane. */
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      className={`panel flex flex-col items-center rounded-[2rem] text-center ${
        compact ? "gap-2 p-6" : "gap-3 p-10"
      }`}
    >
      {icon ? (
        <span
          aria-hidden
          className="bg-surface text-ink-subtle border-border mb-1 flex h-12 w-12 items-center justify-center rounded-full border"
        >
          <span className="text-xl">{icon}</span>
        </span>
      ) : null}

      <h3
        className={`text-ink font-display font-normal uppercase ${
          compact ? "text-lg" : "text-display-sm"
        }`}
      >
        {title}
      </h3>

      {description ? (
        <p className="text-ink-muted max-w-sm text-sm text-pretty">{description}</p>
      ) : null}

      {action ? (
        <Link href={action.href} className="btn btn-outline btn-sm mt-2">
          {action.label}
        </Link>
      ) : null}

      {children}
    </div>
  );
}
