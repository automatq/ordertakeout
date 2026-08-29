import { useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { cancelOrder, formatMoney } from "../api";
import { formatDate, formatTime } from "../format";
import * as haptics from "../haptics";
import { useTheme } from "../theme";
import { Badge, Button, Card } from "../ui/controls";
import { Icon } from "../ui/icons";
import { useTabBarSpace } from "../ui/chrome";
import { PanelSkeleton } from "../ui/skeleton";
import { Body, Display, Label, Overline } from "../ui/text";
import { useTrackedOrder } from "../useTrackedOrder";

/** Where an order is, in the order a customer experiences it. */
const STEPS = [
  { key: "paid", label: "Order placed", caption: "We've received your order." },
  { key: "preparing", label: "Preparing your order", caption: "Freshly made in the kitchen." },
  { key: "ready", label: "Ready for pickup", caption: "Waiting for you at the counter." },
  { key: "completed", label: "Picked up", caption: "Thanks — enjoy!" },
] as const;

const stepIndexFor = (status: string) => {
  const at = STEPS.findIndex((s) => s.key === status);
  return at === -1 ? 0 : at;
};

/**
 * Where your order is up to.
 *
 * The pass itself lives one tap away rather than on this screen, following the
 * design: this answers "is it ready yet", which is a question asked from the
 * sofa, and the pass answers "let me have it", which is asked at a counter.
 */
export function Track({
  orderNumber,
  accessKey,
  onBrowse,
  onShowPass,
}: {
  orderNumber: string | null;
  accessKey: string | null;
  onBrowse: () => void;
  onShowPass: () => void;
}) {
  const { c } = useTheme();
  const chrome = useTabBarSpace();
  const { order, today, saved, offline, gone, refreshing, refresh, onPullToRefresh } =
    useTrackedOrder(orderNumber, accessKey);
  const [canceling, setCanceling] = useState(false);

  if (!order) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
        {gone ? (
          <>
            <Label size={17}>Can't find that order</Label>
            <Body size={14} style={{ textAlign: "center" }}>
              Check the link in your confirmation text — it carries the code that opens it.
            </Body>
          </>
        ) : orderNumber ? (
          <PanelSkeleton />
        ) : (
          <>
            <Icon name="clock" size={30} color={c.inkSubtle} />
            <Label size={17}>No order to track</Label>
            <Body size={14} style={{ textAlign: "center" }}>
              Once you've ordered, this is where the pickup code lives.
            </Body>
            <Pressable onPress={onBrowse} onPressIn={haptics.tap} hitSlop={10} style={{ paddingTop: 6 }}>
              <Label color={c.brand}>See the trays</Label>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const index = stepIndexFor(order.status);
  const canceled = order.status === "canceled";
  const phoneHref = order.pickup.phone ? `tel:${order.pickup.phone.replace(/[^+\d]/g, "")}` : null;
  const when = `${formatDate(order.pickupDate, today ?? "")} at ${formatTime(order.pickupTime)}`;

  /* Offline is a hard no rather than an optimistic queue: a cancellation that
     replays is a double refund, and the customer is standing next to a phone
     number that reaches a person who can do it properly. */
  const offerCancel = order.cancellation.allowed && !canceled && !offline;

  const confirmCancel = () => {
    if (!orderNumber || !accessKey) return;
    Alert.alert(
      "Cancel this order?",
      "Your refund goes back to the card you paid with. This cannot be undone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel order",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setCanceling(true);
              const result = await cancelOrder(orderNumber, accessKey);
              setCanceling(false);
              if (!result.ok) {
                haptics.error();
                Alert.alert("Not cancelled", result.error);
                return;
              }
              haptics.success();
              await refresh();
            })();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingTop: 6, paddingBottom: 30 + chrome, gap: 16 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onPullToRefresh} tintColor={c.brand} />
      }
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View>
          <Overline size={10.5}>Order</Overline>
          <Display size={38} style={{ marginTop: 2 }}>
            {order.orderNumber}
          </Display>
        </View>
        <Badge
          label={canceled ? "Cancelled" : STEPS[index]!.label}
          tint={canceled ? c.statusCanceled : index >= 2 ? c.statusReady : c.statusPreparing}
          background={canceled ? c.statusCanceledSoft : index >= 2 ? c.statusReadySoft : c.statusPreparingSoft}
        />
      </View>

      <Body size={15} color={c.inkMuted} style={{ marginTop: -8 }}>
        {when}
      </Body>

      {/* Stale totals are survivable; a stale "ready to collect" is the sort of
          thing people plan a trip around. */}
      {offline && saved ? (
        <Card style={{ backgroundColor: c.accentSoft, borderColor: c.accentInk + "38" }}>
          <Body size={12.5} color={c.accentInk}>
            Can't reach the shop right now. This is how things stood when you last had signal — your
            collection code still works.
          </Body>
        </Card>
      ) : null}

      {!canceled ? (
        <Card style={{ gap: 0 }}>
          <Overline size={10} color={c.secondary}>
            Fresh from our kitchen
          </Overline>
          <Display size={30} style={{ marginTop: 5 }}>
            Order progress
          </Display>
          <View style={{ height: 20 }} />
          {STEPS.map((step, i) => {
            const state = i < index ? "done" : i === index ? "current" : "todo";
            return (
              <View key={step.key} style={{ flexDirection: "row", gap: 13 }}>
                <View style={{ alignItems: "center", width: 28 }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      borderWidth: 2,
                      alignItems: "center",
                      justifyContent: "center",
                      borderColor: state === "todo" ? c.border : state === "done" ? c.secondary : c.accent,
                      backgroundColor:
                        state === "todo" ? "transparent" : state === "done" ? c.secondary : c.accent,
                    }}
                  >
                    {state === "done" ? <Icon name="check" size={14} color={c.brandInk} strokeWidth={2.4} /> : null}
                  </View>
                  {i < STEPS.length - 1 ? (
                    <View
                      style={{
                        width: 2,
                        flex: 1,
                        minHeight: 26,
                        backgroundColor: i < index ? c.secondary : c.border,
                      }}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1, paddingBottom: i < STEPS.length - 1 ? 18 : 0 }}>
                  <Label
                    size={14.5}
                    color={state === "todo" ? c.inkSubtle : state === "current" ? c.statusPreparing : c.ink}
                  >
                    {step.label}
                    {state === "current" ? " — in progress" : ""}
                  </Label>
                  <Body size={12.5} color={c.inkSubtle} style={{ marginTop: 1 }}>
                    {step.caption}
                  </Body>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card style={{ gap: 8 }}>
        <Overline>Your trays</Overline>
        {order.items.map((item, i) => (
          <View key={`${item.name}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Body size={14} style={{ flex: 1 }}>
              {item.quantity} × {item.name}
            </Body>
            <Label size={14} style={{ fontVariant: ["tabular-nums"] }}>
              {formatMoney(item.totalPriceCents, order.currency)}
            </Label>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: c.border, marginVertical: 4 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Label size={15}>Total</Label>
          <Label size={16} style={{ fontVariant: ["tabular-nums"] }}>
            {formatMoney(order.totalCents, order.currency)}
          </Label>
        </View>
      </Card>

      <Card style={{ gap: 4 }}>
        <Overline size={10}>Collect</Overline>
        <Label size={14}>{when}</Label>
        <Body size={12.5}>
          {[order.pickup.name, order.pickup.address, order.pickup.city].filter(Boolean).join(", ")}
        </Body>
      </Card>

      <View style={{ gap: 10 }}>
        {order.pickupPass ? (
          <Button label="Show pickup pass" icon="bag" onPress={onShowPass} />
        ) : null}
        {phoneHref ? (
          <Button
            label="Call the shop"
            icon="phone"
            variant="secondary"
            onPress={() => void Linking.openURL(phoneHref)}
          />
        ) : null}
        {offerCancel ? (
          <Button label="Cancel order" variant="danger" busy={canceling} onPress={confirmCancel} />
        ) : null}
        {/* Said out loud rather than left as an absent button: "why can I not
            cancel" is otherwise a phone call the counter has to answer. */}
        {!offerCancel && !canceled && order.cancellation.reason ? (
          <Body size={12.5} style={{ textAlign: "center" }}>
            {order.cancellation.reason}
          </Body>
        ) : null}
      </View>
    </ScrollView>
  );
}
