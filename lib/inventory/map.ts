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

/** Compare the whole requested cart against Square's location quantities. */
export function inventoryShortages(
  requested: readonly InventoryRequest[],
  available: ReadonlyMap<string, number>,
): InventoryShortage[] {
  return requested.flatMap((line) => {
    const quantity = Math.max(0, Math.floor(available.get(line.variationId) ?? 0));
    return quantity >= line.quantity ? [] : [{ ...line, available: quantity }];
  });
}
