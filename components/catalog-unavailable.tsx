import { STORE_HOURS } from "@/lib/store";

/**
 * Shown when Square or the database can't be reached.
 *
 * Deliberately not an empty product grid: an empty shop reads as "this bakery
 * sells nothing", which loses the order outright. Saying so plainly and pointing
 * the customer at the phone keeps the sale.
 */
export function CatalogUnavailable() {
  return (
    <section
      role="status"
      className="rounded-card border-border bg-surface-sunken border p-8 text-center"
    >
      <h2 className="text-ink text-lg font-semibold">Online ordering is temporarily down</h2>
      <p className="text-ink-muted mx-auto mt-2 max-w-md text-sm text-pretty">
        We can&rsquo;t load the menu right now. Party tray orders can still be placed by
        phone or in store, {STORE_HOURS.opens}&ndash;{STORE_HOURS.closes} daily.
      </p>
    </section>
  );
}
