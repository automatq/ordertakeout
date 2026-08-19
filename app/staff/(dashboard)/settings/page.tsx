import { connection } from "next/server";
import { Suspense } from "react";

import { ProductRulesForm } from "@/components/staff/product-rules-form";
import {
  BlackoutDates,
  CatalogResync,
  SlotCapacity,
} from "@/components/staff/schedule-settings";
import { listBlackoutDates, listProductRules, listSlotCapacity } from "@/lib/admin/queries";
import { getStoreCatalog } from "@/lib/catalog/server";
import { DEFAULT_MAX_ORDERS_PER_SLOT } from "@/lib/store";

export const metadata = { title: "Settings — Staff" };

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-8">
      <h1 className="font-display text-ink text-2xl font-semibold">Ordering settings</h1>
      <Suspense fallback={<p className="text-ink-muted text-sm">Loading settings…</p>}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  await connection();

  const [catalog, rules, blackouts, slots] = await Promise.all([
    getStoreCatalog(),
    listProductRules(),
    listBlackoutDates(),
    listSlotCapacity(),
  ]);

  const rulesById = new Map(rules.map((rule) => [rule.productId, rule]));

  return (
    <>
      <CatalogResync />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-ink text-lg font-semibold">Ordering rules</h2>
          <p className="text-ink-muted text-sm">
            How far ahead each product must be ordered, the daily cutoff, and which pickup
            times are offered.
          </p>
        </div>

        {catalog.error ? (
          <p role="alert" className="text-danger text-sm">
            Couldn&rsquo;t load products from Square. Try the sync button above, or check
            back shortly.
          </p>
        ) : null}

        {/*
          Products Square knows about but we have no rules for. They are not
          sellable until configured — without a cutoff we'd be promising a pickup
          the kitchen never agreed to — so they're surfaced first rather than
          silently missing from the shop.
        */}
        {catalog.unconfigured.map((product) => (
          <ProductRulesForm
            key={product.id}
            productId={product.id}
            productName={product.name}
            unconfigured
          />
        ))}

        {catalog.products.map((product) => (
          <ProductRulesForm
            key={product.id}
            productId={product.id}
            productName={product.name}
            existing={rulesById.get(product.id)}
          />
        ))}

        {catalog.products.length === 0 && catalog.unconfigured.length === 0 ? (
          <p className="text-ink-muted text-sm">
            No products found in your Square item library yet.
          </p>
        ) : null}
      </section>

      <BlackoutDates dates={blackouts} />
      <SlotCapacity slots={slots} defaultCap={DEFAULT_MAX_ORDERS_PER_SLOT} />
    </>
  );
}
