import { connection } from "next/server";
import { Suspense } from "react";

import {
  ProductRulesList,
  type RuleListItem,
} from "@/components/staff/product-rules-list";
import {
  BlackoutDates,
  CatalogResync,
  SlotCapacity,
} from "@/components/staff/schedule-settings";
import { AlertIcon } from "@/components/ui/icons";
import { FormSkeleton } from "@/components/ui/skeleton";
import { listBlackoutDates, listOperationalIssues, listProductRules, listSlotCapacity } from "@/lib/admin/queries";
import { getStoreCatalog } from "@/lib/catalog/server";
import { primaryImage } from "@/lib/catalog/images";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { DEFAULT_MAX_ORDERS_PER_SLOT } from "@/lib/store";

export const metadata = { title: "Settings — Staff" };

/** Jump links, so the page's four sections are reachable without scrolling. */
const SECTIONS = [
  { id: "sync", label: "Square sync" },
  { id: "operations", label: "Operations" },
  { id: "rules", label: "Ordering rules" },
  { id: "closures", label: "Closures" },
  { id: "capacity", label: "Slot capacity" },
] as const;

export default function SettingsPage() {
  return (
    <div className="shell-tight flex flex-col gap-8 py-8">
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-ink text-display-md font-normal uppercase">
          Ordering settings
        </h1>

        <nav aria-label="Settings sections" className="scroll-row bg-canvas/95 sticky top-20 z-20 gap-2 py-2 backdrop-blur">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="btn btn-secondary btn-sm">
              {section.label}
            </a>
          ))}
        </nav>
      </div>

      <Suspense fallback={<FormSkeleton label="Loading settings" fields={5} />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  await connection();

  const [catalog, rules, blackouts, slots, locations, issues] = await Promise.all([
    getStoreCatalog(),
    listProductRules(),
    listBlackoutDates(),
    listSlotCapacity(),
    getStoreLocationsSafe(),
    listOperationalIssues(),
  ]);

  const rulesById = new Map(rules.map((rule) => [rule.productId, rule]));

  /*
    Unconfigured products first. They are not sellable until configured —
    without a cutoff we'd be promising a pickup the kitchen never agreed to — so
    they lead the list rather than being silently missing from the shop.
  */
  const items: RuleListItem[] = [
    ...catalog.unconfigured.map((product) => ({
      id: product.id,
      name: product.name,
      imageUrl: primaryImage(product),
      unconfigured: true,
    })),
    ...catalog.products.map((product) => ({
      id: product.id,
      name: product.name,
      imageUrl: primaryImage(product),
      rule: rulesById.get(product.id),
      unconfigured: false,
    })),
  ];

  return (
    <div className="flex flex-col gap-12">
      <section id="sync" className="scroll-mt-24">
        <CatalogResync />
      </section>

      <section id="operations" className="scroll-mt-24">
        <OperationalIssues issues={issues} />
      </section>

      <section id="rules" className="flex scroll-mt-24 flex-col gap-4">
        <div>
          <h2 className="text-ink text-lg font-semibold">Ordering rules</h2>
          <p className="text-ink-muted text-sm">
            How far ahead each product must be ordered, the daily cutoff, and which pickup
            times are offered.
          </p>
        </div>

        {/* At the top of the section, not below the heading it belongs to — a
            failed Square load is the first thing that explains an empty list. */}
        {catalog.error ? (
          <p role="alert" className="panel border-danger/30 flex items-start gap-2 p-4 text-sm">
            <AlertIcon className="text-danger mt-0.5 h-4 w-4 shrink-0" />
            Couldn&rsquo;t load products from Square. Try the sync button above, or check
            back shortly.
          </p>
        ) : null}

        {items.length === 0 ? (
          <p className="text-ink-muted text-sm">
            No products found in your Square item library yet.
          </p>
        ) : (
          <ProductRulesList products={items} />
        )}
      </section>

      <section id="closures" className="scroll-mt-24">
        <BlackoutDates dates={blackouts} locations={locations} />
      </section>

      <section id="capacity" className="scroll-mt-24">
        <SlotCapacity slots={slots} defaultCap={DEFAULT_MAX_ORDERS_PER_SLOT} locations={locations} />
      </section>
    </div>
  );
}

function OperationalIssues({ issues }: { issues: Awaited<ReturnType<typeof listOperationalIssues>> }) {
  const count = issues.refunds.length + issues.squareSync.length + issues.notifications.length + issues.webhooks.length;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-lg font-semibold">Operations</h2>
        <p className="text-ink-muted text-sm">Refund, alert and Square webhook failures that need attention.</p>
      </div>
      {count === 0 ? (
        <p className="panel p-4 text-sm text-success">No unresolved operational failures.</p>
      ) : (
        <div role="alert" className="panel border-danger/30 flex flex-col gap-3 p-4 text-sm">
          {issues.refunds.map((issue) => (
            <p key={`refund-${issue.orderNumber}`}>
              <strong>{issue.orderNumber} refund:</strong>{" "}
              {issue.status === "pending"
                ? "Still pending after 30 minutes; check the refund in Square."
                : issue.error}
            </p>
          ))}
          {issues.squareSync.map((issue) => <p key={`square-${issue.orderNumber}`}><strong>{issue.orderNumber} Square sync:</strong> {issue.error}</p>)}
          {issues.notifications.map((issue) => <p key={`notification-${issue.orderId}-${issue.channel}-${issue.event}`}><strong>{issue.channel} alert ({issue.event}, attempt {issue.attempts}):</strong> {issue.error}</p>)}
          {issues.webhooks.map((issue, index) => <p key={`webhook-${issue.receivedAt.toISOString()}-${index}`}><strong>{issue.eventType} webhook:</strong> {issue.error}</p>)}
        </div>
      )}
    </div>
  );
}
