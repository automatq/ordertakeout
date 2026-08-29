import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";

import {
  fetchAccountOrders,
  fetchAccountRewards,
  formatMoney,
  type AccountOrder,
  type PickupShop,
  type Profile,
  type RewardEntryKind,
  type Rewards,
} from "../api";
import { formatDate, formatTime } from "../format";
import { statusFor } from "../status";
import * as haptics from "../haptics";
import { useTheme } from "../theme";
import { Badge, Button, Card } from "../ui/controls";
import { Icon } from "../ui/icons";
import { useTabBarSpace } from "../ui/chrome";
import { Body, Display, Label, Overline, Tabular } from "../ui/text";

/**
 * Account and order history.
 *
 * "What did I get last time" is most of why anybody opens this, so the past is
 * kept rather than tidied away — and it is the thing reordering will be built on
 * once checkout exists.
 */
export function Account({
  token,
  profile,
  shop,
  onSignIn,
  onSignOut,
  onChangeShop,
  onBrowse,
}: {
  token: string | null;
  /** The signed-in customer, once their details have loaded. */
  profile: Profile | null;
  shop: PickupShop | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onChangeShop: () => void;
  onBrowse: () => void;
}) {
  const { c } = useTheme();
  const chrome = useTabBarSpace();
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    /* Both at once, and the balance is allowed to fail on its own: points are
       the smaller half of this screen, and losing them should not cost somebody
       standing in the shop the order history they actually came to check. */
    const [history, balance] = await Promise.all([
      fetchAccountOrders(token),
      fetchAccountRewards(token),
    ]);
    if (history.ok) {
      setOrders(history.data.orders);
      setToday(history.data.today);
      setError(null);
    } else {
      setError(history.error);
    }
    setRewards(balance.ok ? balance.data : null);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingTop: 6, paddingBottom: 30 + chrome, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brand} />}
    >
      {/* Greeted by name once there is a name to greet by. The screen was headed
          with a bare "Account" for as long as the app had no way to ask who the
          customer was. */}
      <Display size={38}>
        {profile ? `Hi, ${profile.name.split(" ")[0]}` : "Account"}
      </Display>

      <Pressable
        onPress={onChangeShop}
        onPressIn={haptics.tap}
        accessibilityRole="button"
        accessibilityLabel="Change pickup shop"
      >
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              backgroundColor: c.secondarySoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="pin" size={17} color={c.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Overline size={9.5}>Usual pickup shop</Overline>
            <Label size={14}>{shop?.name ?? "Not chosen yet"}</Label>
          </View>
          <Icon name="chevronRight" size={16} color={c.inkSubtle} />
        </Card>
      </Pressable>

      {!token ? (
        <Card style={{ gap: 12 }}>
          <Label size={17}>Sign in to see your orders</Label>
          <Body size={14}>
            We'll text you a code — no password to remember. Your pickup code works either way.
          </Body>
          <Button label="Sign in" onPress={onSignIn} />
        </Card>
      ) : (
        <>
          {rewards ? <RewardsCard rewards={rewards} /> : null}

          <Overline>Your orders</Overline>

          {!orders ? (
            error ? (
              <Card style={{ gap: 10 }}>
                <Body size={14}>{error}</Body>
                <Button label="Try again" variant="secondary" onPress={onRefresh} />
              </Card>
            ) : (
              <ActivityIndicator color={c.brand} style={{ paddingVertical: 32 }} />
            )
          ) : orders.length === 0 ? (
            <Card style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
              <Label size={16}>Nothing yet</Label>
              <Body size={14} style={{ textAlign: "center" }}>
                Orders you place will show up here.
              </Body>
              <Pressable onPress={onBrowse} onPressIn={haptics.tap} hitSlop={10}>
                <Label color={c.brand}>See the trays</Label>
              </Pressable>
            </Card>
          ) : (
            orders.map((order) => {
              const status = statusFor(order.status, c);
              return (
                <Card key={order.orderNumber} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <Label size={16}>{order.orderNumber}</Label>
                    <Badge label={status.label} tint={status.fg} background={status.bg} />
                  </View>
                  <Body size={13} color={c.inkSubtle}>
                    {formatDate(order.pickupDate, today ?? "")} at {formatTime(order.pickupTime)}
                    {order.pickupLocationName ? ` · ${order.pickupLocationName}` : ""}
                  </Body>
                  {order.items.map((item, i) => (
                    <Body key={`${item.name}-${i}`} size={14}>
                      {item.quantity} × {item.name}
                    </Body>
                  ))}
                  <Label size={15} style={{ marginTop: 4, fontVariant: ["tabular-nums"] }}>
                    {formatMoney(order.totalCents, order.currency)}
                  </Label>
                </Card>
              );
            })
          )}

          <Pressable onPress={onSignOut} onPressIn={haptics.tap} hitSlop={10} style={{ paddingVertical: 12 }}>
            <Body size={15} color={c.inkSubtle} style={{ textAlign: "center" }}>
              Sign out
            </Body>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

/** What each ledger row means, in the customer's words rather than the column's. */
const LEDGER_COPY: Record<RewardEntryKind, string> = {
  earned: "Points earned",
  redeemed: "Reward redeemed",
  reversed: "Returned after cancellation",
  revoked: "Reversed after refund",
};

/**
 * Rewards balance and recent activity.
 *
 * Read-only, deliberately. Redeeming happens at checkout, and this build's
 * checkout cannot take money yet — so offering a "use my reward" control here
 * would be offering a button that leads nowhere. The balance is still worth
 * showing on its own: it is the answer to "how close am I", which is the only
 * question anybody opens this card to ask.
 */
function RewardsCard({ rewards }: { rewards: Rewards }) {
  const { c } = useTheme();
  const { points, rewardPoints, rewardDiscountCents, entries } = rewards;

  const ready = points >= rewardPoints;
  const remaining = Math.max(0, rewardPoints - points);
  /* Guard the divide: a shop that set the threshold to zero would otherwise
     render NaN% and a bar of no width. */
  const progress = rewardPoints > 0 ? Math.min(100, Math.round((points / rewardPoints) * 100)) : 100;
  const reward = formatMoney(rewardDiscountCents, "CAD");

  return (
    <>
      <Overline>Rewards</Overline>
      <Card style={{ gap: 10 }}>
        <Display size={30}>
          {points} {points === 1 ? "point" : "points"}
        </Display>

        <Body size={14}>
          {ready
            ? `Your ${reward} reward is ready.`
            : `${remaining} ${remaining === 1 ? "point" : "points"} until ${reward} off.`}
        </Body>

        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${points} of ${rewardPoints} points towards ${reward} off`}
          accessibilityValue={{ min: 0, max: rewardPoints, now: Math.min(points, rewardPoints) }}
          style={{ height: 8, borderRadius: 999, backgroundColor: c.surfaceSunken, overflow: "hidden" }}
        >
          <View style={{ width: `${progress}%`, height: "100%", borderRadius: 999, backgroundColor: c.accent }} />
        </View>

        <Body size={13} color={c.inkSubtle}>
          One point per dollar, added once you've collected your order.
        </Body>

        {entries.length > 0 ? (
          <View style={{ gap: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 }}>
            {entries.map((entry) => (
              <View
                key={entry.id}
                style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}
              >
                <Body size={13} color={c.inkSubtle} style={{ flex: 1 }}>
                  {LEDGER_COPY[entry.kind]} · {entry.orderNumber}
                </Body>
                <Tabular size={13} color={entry.points >= 0 ? c.success : c.danger}>
                  {entry.points >= 0 ? "+" : ""}
                  {entry.points} pts
                </Tabular>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </>
  );
}
