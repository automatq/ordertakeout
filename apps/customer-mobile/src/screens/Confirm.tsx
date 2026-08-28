import { ScrollView, View } from "react-native";

import { formatMoney } from "../api";
import { formatDate, formatTime } from "../format";
import { shadows, useTheme } from "../theme";
import { Button } from "../ui/controls";
import { Icon } from "../ui/icons";
import { PassDetail, PickupPass } from "../ui/pass";
import { PanelSkeleton } from "../ui/skeleton";
import { Body, Display, Label } from "../ui/text";
import { useTrackedOrder } from "../useTrackedOrder";

/**
 * The pickup pass, on its own screen.
 *
 * Two moments share it. Straight out of checkout it is a receipt — the tick,
 * the amount, where the details went. Reopened later from the tracker it is
 * just the code, because telling somebody their order is confirmed twenty
 * minutes before collection is answering a question they stopped asking.
 */
export function Confirm({
  orderNumber,
  accessKey,
  mode,
  onTrack,
  onHome,
}: {
  orderNumber: string | null;
  accessKey: string | null;
  mode: "confirmation" | "pass";
  onTrack: () => void;
  onHome: () => void;
}) {
  const { c, scheme } = useTheme();
  const sh = shadows(scheme);
  const { order, today } = useTrackedOrder(orderNumber, accessKey);

  if (!order) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <PanelSkeleton />
      </View>
    );
  }

  const when = `${formatDate(order.pickupDate, today ?? "")} at ${formatTime(order.pickupTime)}`;
  const where = [order.pickup.name, order.pickup.address].filter(Boolean).join(", ");

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 18, paddingBottom: 26 }}
    >
      {mode === "confirmation" ? (
        <View style={{ paddingHorizontal: 20, alignItems: "center" }}>
          <View
            style={[
              {
                width: 64,
                height: 64,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.brand,
              },
              sh.brand,
            ]}
          >
            <Icon name="check" size={30} color="#ffffff" strokeWidth={2.2} />
          </View>
          <Display size={42} style={{ marginTop: 16, textAlign: "center" }}>
            Order confirmed
          </Display>
          <Body size={14} style={{ marginTop: 9, textAlign: "center" }}>
            Paid {formatMoney(order.totalCents, order.currency)}. We&rsquo;ve texted the details and
            emailed a receipt.
          </Body>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 20 }}>
          <Display size={34}>Your pickup pass</Display>
          <Body size={14} style={{ marginTop: 4 }}>
            {order.customerName}
          </Body>
        </View>
      )}

      <View style={{ paddingTop: 22, paddingHorizontal: 18 }}>
        {order.pickupPass ? (
          <PickupPass
            orderNumber={order.orderNumber}
            pass={order.pickupPass}
            details={
              <>
                <PassDetail
                  background={c.accentSoft}
                  icon={<Icon name="calendar" size={17} color={c.accentInk} />}
                >
                  {when}
                </PassDetail>
                <PassDetail
                  background={c.secondarySoft}
                  icon={<Icon name="pin" size={17} color={c.secondary} />}
                >
                  {where}
                </PassDetail>
              </>
            }
          />
        ) : (
          <View style={{ alignItems: "center", gap: 8, paddingVertical: 24 }}>
            <Label size={16}>Nothing left to collect</Label>
            <Body size={13.5} style={{ textAlign: "center" }}>
              This order has been {order.status === "canceled" ? "cancelled" : "handed over"}, so its
              pass has been retired.
            </Body>
          </View>
        )}
      </View>

      <View style={{ gap: 10, paddingTop: 20, paddingHorizontal: 20 }}>
        {mode === "confirmation" ? (
          <Button label="Track my order" onPress={onTrack} icon="arrowRight" />
        ) : null}
        <Button label="Back to home" variant="ghost" onPress={onHome} />
      </View>
    </ScrollView>
  );
}
