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
  pickupLocationName?: string | null;
  pickupLocationId?: string | null;
  pickupLocationAddress?: string | null;
  totalCents: number;
  /** Gratuity charged on top of totalCents. */
  tipCents?: number;
  currency: string;
  items: { quantity: number; name: string }[];
  note: string | null;
  trackingUrl?: string | null;
  /** Per-order consent to transactional texts. */
  customerSmsOptIn?: boolean;
}

export type NotificationEventKind =
  | "order_paid"
  | "order_ready"
  | "order_canceled"
  | "order_refunded";

export interface NotificationEvent {
  kind: NotificationEventKind;
  order: OrderNotification;
  /**
   * Claim/record key in notification_log; defaults to `kind`. Events that can
   * legitimately recur per order (a second partial refund, a future reminder)
   * pass a suffixed key like `order_refunded:<refundId>` so each occurrence is
   * its own idempotent delivery unit.
   */
  dedupeKey?: string;
  /** Restrict delivery to these channels; omitted = all configured channels. */
  channels?: ChannelName[];
  /** Present for order_refunded. */
  refund?: { amountCents: number; partial: boolean };
}

export type ChannelName =
  | "email"
  | "email_store"
  | "email_customer"
  | "sms"
  | "sms_customer"
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
