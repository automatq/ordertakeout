/** Whether a Square inventory-count record makes a variation purchasable. */
export function isInStockCount(count: { catalogObjectId?: string | null; quantity?: string | null }): boolean {
  return Boolean(count.catalogObjectId && Number(count.quantity ?? "0") > 0);
}

export interface InventoryRequest {
  variationId: string;
  quantity: number;
}

export interface InventoryShortage extends InventoryRequest {
  available: number;
}

/**
 * Collapse duplicate cart lines while retaining their first presentation order.
 * The reservation layer separately sorts advisory lock identities.
 */
export function normalizeInventoryRequests(
  requested: readonly InventoryRequest[],
): InventoryRequest[] {
  const quantities = new Map<string, number>();

  for (const line of requested) {
    if (!line.variationId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError("Inventory requests require a variation id and a positive integer quantity");
    }
    quantities.set(line.variationId, (quantities.get(line.variationId) ?? 0) + line.quantity);
  }

  return [...quantities]
    .map(([variationId, quantity]) => ({ variationId, quantity }));
}

/** Subtract active local reservations from Square's raw location counts. */
export function availableInventoryAfterHolds(
  rawSquareQuantities: ReadonlyMap<string, number>,
  heldQuantities: ReadonlyMap<string, number>,
): Map<string, number> {
  const variationIds = new Set([
    ...rawSquareQuantities.keys(),
    ...heldQuantities.keys(),
  ]);

  return new Map(
    [...variationIds].map((variationId) => {
      const raw = Math.max(0, Math.floor(rawSquareQuantities.get(variationId) ?? 0));
      const held = Math.max(0, Math.floor(heldQuantities.get(variationId) ?? 0));
      return [variationId, Math.max(0, raw - held)] as const;
    }),
  );
}

/** Compare the whole requested cart against Square's location quantities. */
export function inventoryShortages(
  requested: readonly InventoryRequest[],
  available: ReadonlyMap<string, number>,
): InventoryShortage[] {
  return normalizeInventoryRequests(requested).flatMap((line) => {
    const quantity = Math.max(0, Math.floor(available.get(line.variationId) ?? 0));
    return quantity >= line.quantity ? [] : [{ ...line, available: quantity }];
  });
}
