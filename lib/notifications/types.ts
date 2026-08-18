import type { StoreDate, StoreTime } from "@/lib/scheduling/time";

/** Everything any channel needs about an order, flattened and serialisable. */
export interface OrderNotification {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  pickupDate: StoreDate;
  pickupTime: StoreTime;
  totalCents: number;
  currency: string;
  items: { quantity: number; name: string }[];
  note: string | null;
}

export type NotificationEventKind = "order_paid" | "order_ready" | "order_canceled";

export interface NotificationEvent {
  kind: NotificationEventKind;
  order: OrderNotification;
}

export type ChannelName =
  | "email"
  | "sms"
  | "discord"
  | "slack"
  | "trello"
  | "webhook";

export interface ChannelResult {
  channel: ChannelName;
  ok: boolean;
  error?: string;
  /** True when the channel isn't configured — skipped, not failed. */
  skipped?: boolean;
}
