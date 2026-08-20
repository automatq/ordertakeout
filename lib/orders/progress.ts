import type { OrderStatus } from "@/lib/db/schema";

const REACHED: Partial<Record<OrderStatus, number>> = {
  paid: 0,
  preparing: 1,
  ready: 2,
  completed: 3,
};

export function orderProgressStepState(
  status: OrderStatus,
  index: number,
): { isDone: boolean; isCurrent: boolean } | null {
  const reached = REACHED[status];
  if (reached === undefined) return null;

  const isTerminal = status === "completed";
  return {
    isDone: index < reached || (isTerminal && index === reached),
    isCurrent: !isTerminal && index === reached,
  };
}
