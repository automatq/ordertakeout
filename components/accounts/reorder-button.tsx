"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { prepareReorder, type ReorderPreview } from "@/app/actions/reorder";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useCart } from "@/lib/cart/store";

/**
 * Reorder with a pre-check instead of blind cart restoration.
 *
 * The server compares the past order against today's catalog (menus change);
 * when everything is available the cart fills in one tap, and when it isn't, a
 * small confirm sheet says exactly what still can be ordered — "2 of 3" — so
 * nobody discovers a missing tray at checkout. Only immutable variant IDs and
 * quantities are restored; price and slot availability re-check at checkout.
 */
export function ReorderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const cart = useCart();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ReorderPreview | null>(null);

  function addToCart(items: ReorderPreview["items"]) {
    const available = items.filter((item) => item.available);
    for (const item of available) cart.add(item.variantId, item.quantity);
    setPreview(null);
    router.push("/cart");
  }

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await prepareReorder({ orderId });
        if (!result.ok) {
          toast({ tone: "error", message: result.message });
          return;
        }
        const availableCount = result.items.filter((item) => item.available).length;
        if (availableCount === 0) {
          toast({
            tone: "info",
            message: "None of these items are on the current menu — browse the trays for what's fresh.",
          });
          return;
        }
        if (availableCount === result.items.length) {
          addToCart(result.items);
          return;
        }
        setPreview(result);
      } catch {
        toast({ tone: "error", message: "Couldn't check that order. Try again." });
      }
    });
  }

  const availableCount = preview?.items.filter((item) => item.available).length ?? 0;

  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm rounded-full"
        disabled={!cart.ready || isPending}
        onClick={handleClick}
      >
        {isPending ? <span className="spinner" aria-hidden /> : null}
        {isPending ? "Checking…" : "Order again"}
      </button>

      {preview ? (
        <div
          className="bg-ink/50 fixed inset-0 z-50 flex items-end p-0 sm:items-center sm:justify-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`reorder-heading-${orderId}`}
            className="bg-canvas shadow-raised flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-[2rem] p-5 sm:max-w-md sm:rounded-[2rem] sm:p-7"
          >
            <div>
              <p className="text-secondary text-xs font-semibold tracking-[0.14em] uppercase">
                Order again
              </p>
              <h2
                id={`reorder-heading-${orderId}`}
                className="font-display text-ink mt-1 text-3xl font-normal uppercase"
              >
                {availableCount} of {preview.items.length} items available
              </h2>
            </div>
            <p className="text-ink-muted text-sm">
              The menu has changed since this order. We can add what&rsquo;s still offered:
            </p>
            <ul className="flex flex-col gap-2">
              {preview.items.map((item) => (
                <li key={item.variantId} className="flex items-center gap-3 text-sm">
                  {item.available ? (
                    <CheckIcon className="text-success h-4 w-4 shrink-0" />
                  ) : (
                    <CloseIcon className="text-ink-subtle h-4 w-4 shrink-0" />
                  )}
                  <span className={item.available ? "text-ink" : "text-ink-subtle line-through"}>
                    {item.quantity} &times; {item.name}
                  </span>
                  {!item.available ? (
                    <span className="text-ink-subtle ml-auto shrink-0 text-xs">not offered</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                className="btn btn-ghost btn-sm rounded-full"
                onClick={() => setPreview(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm rounded-full"
                onClick={() => addToCart(preview.items)}
              >
                Add {availableCount} item{availableCount === 1 ? "" : "s"} to cart
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
