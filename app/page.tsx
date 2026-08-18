import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { ProductCard } from "@/components/product-card";
import { getOrderableProducts } from "@/lib/catalog/server";
import { STORE_HOURS } from "@/lib/store";

/**
 * Storefront listing.
 *
 * Products come from Square Catalog joined to the ordering rules in our
 * database — nothing about the menu is hardcoded, so the store edits prices in
 * the Square Dashboard exactly as they do today.
 */
export default async function HomePage() {
  const { products, error } = await getOrderableProducts();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-ink-subtle text-sm font-medium tracking-wide uppercase">
          Pre-order &amp; pickup
        </p>
        <h1 className="font-display text-ink text-4xl font-semibold text-balance">
          Party trays, ready when you are
        </h1>
        <p className="text-ink-muted max-w-2xl text-lg text-pretty">
          Order ahead, choose a pickup time, and collect in store. Open{" "}
          {STORE_HOURS.opens}&ndash;{STORE_HOURS.closes}, every day.
        </p>
      </header>

      {error ? (
        <CatalogUnavailable />
      ) : products.length === 0 ? (
        <section
          role="status"
          className="rounded-card border-border bg-surface-sunken border p-8 text-center"
        >
          <h2 className="text-ink text-lg font-semibold">No trays available right now</h2>
          <p className="text-ink-muted mx-auto mt-2 max-w-md text-sm text-pretty">
            Please check back soon, or call the store to ask about party tray orders.
          </p>
        </section>
      ) : (
        <section aria-label="Party trays" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </section>
      )}
    </main>
  );
}
