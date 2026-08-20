import { AlertIcon, PhoneIcon } from "@/components/ui/icons";
import { STORE_HOURS, STORE_INFO } from "@/lib/store";

/**
 * Shown when Square or the database can't be reached.
 *
 * Deliberately not an empty product grid: an empty shop reads as "this bakery
 * sells nothing", which loses the order outright. Saying so plainly and pointing
 * the customer at the phone keeps the sale.
 */
export function CatalogUnavailable() {
  return (
    <section role="status" className="panel flex flex-col items-center gap-3 rounded-[2rem] p-10 text-center">
      <span
        aria-hidden
        className="bg-surface text-warning border-border flex h-12 w-12 items-center justify-center rounded-full border"
      >
        <AlertIcon className="h-6 w-6" />
      </span>

      <h2 className="text-brand font-display text-display-md font-normal uppercase">
        Online ordering is temporarily down
      </h2>
      <p className="text-ink-muted max-w-md text-sm text-pretty">
        We can&rsquo;t load the menu right now. Party tray orders can still be placed by
        phone or in store, {STORE_HOURS.opens}&ndash;{STORE_HOURS.closes} daily.
      </p>

      {/* The point of this screen is to keep the sale, so the phone number is
          the action — not a sentence mentioning that a phone exists. */}
      <a href={STORE_INFO.phoneHref} className="btn btn-primary btn-sm mt-2">
        <PhoneIcon className="h-4 w-4" />
        Call {STORE_INFO.phone}
      </a>
    </section>
  );
}
