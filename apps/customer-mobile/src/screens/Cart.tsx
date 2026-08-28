import { Pressable, ScrollView, View } from "react-native";

import { formatMoney, type PickupShop } from "../api";
import type { CartTotals } from "../cart";
import { taxOn } from "./Checkout";
import * as haptics from "../haptics";
import { radius, useTheme } from "../theme";
import { Button, Card, RoundButton, Stepper } from "../ui/controls";
import { Photo } from "../ui/photo";
import { Icon } from "../ui/icons";
import { useCtaSpace } from "../ui/chrome";
import { Body, Display, Label, Overline, Tabular } from "../ui/text";

/**
 * The order so far.
 *
 * HST is shown here rather than held back for checkout. It is a flat provincial
 * rate on the subtotal — it does not move when a shop or a slot is picked — so
 * withholding it would only mean the total appearing to rise at the last step.
 */
export function Cart({
  totals,
  shop,
  onBack,
  onQuantity,
  onRemove,
  onBrowse,
  onChangeShop,
}: {
  totals: CartTotals;
  shop: PickupShop | null;
  onBack: () => void;
  onQuantity: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
  onBrowse: () => void;
  onChangeShop: () => void;
}) {
  const { c } = useTheme();
  const chrome = useCtaSpace();

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 + chrome }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 18, paddingTop: 6 }}>
        <RoundButton icon="arrowLeft" label="Back" onPress={onBack} />
        <Display size={38}>Your order</Display>
      </View>

      {/* A total that changed by itself with no explanation is worse than the
          item visibly going. */}
      {totals.droppedCount > 0 ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
          <Card style={{ backgroundColor: c.accentSoft, borderColor: c.accentInk + "38" }}>
            <Body size={12.5} color={c.accentInk}>
              {totals.droppedCount === 1 ? "A tray" : `${totals.droppedCount} trays`} came off your order
              — {totals.droppedCount === 1 ? "it is" : "they are"} no longer on the menu.
            </Body>
          </Card>
        </View>
      ) : null}

      {totals.lines.length === 0 ? (
        <View style={{ alignItems: "center", gap: 10, paddingVertical: 64, paddingHorizontal: 32 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: c.surface,
            }}
          >
            <Icon name="bag" size={24} color={c.brand} />
          </View>
          <Body size={14} style={{ textAlign: "center" }}>
            Your order is empty.
          </Body>
          <Pressable onPress={onBrowse} onPressIn={haptics.tap} hitSlop={10} style={{ paddingTop: 6 }}>
            <Label color={c.brand}>Browse trays</Label>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 12, paddingHorizontal: 20 }}>
          {totals.lines.map((line, index) => (
            <Card key={`${line.variantId}-${index}`} padded={false} style={{ padding: 13 }}>
              <View style={{ flexDirection: "row", gap: 13 }}>
                {line.product.imageUrl ? (
                  <Photo
                    uri={line.product.imageUrl}
                    style={{ width: 74, height: 74, borderRadius: radius.control }}
                  />
                ) : (
                  <View
                    style={{ width: 74, height: 74, borderRadius: radius.control, backgroundColor: c.surfaceSunken }}
                  />
                )}

                <View style={{ flex: 1, gap: 2 }}>
                  <Label size={14.5} numberOfLines={2}>
                    {line.product.name}
                  </Label>
                  <Body size={12.5} color={c.inkSubtle}>
                    {line.variant.name}
                  </Body>
                  <Display size={22} color={c.brand} style={{ marginTop: 4 }}>
                    {formatMoney(line.totalCents, line.variant.currency)}
                  </Display>
                </View>

                <View style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
                  <Pressable
                    onPress={() => onRemove(index)}
                    onPressIn={haptics.tap}
                    hitSlop={10}
                    accessibilityLabel={`Remove ${line.product.name}`}
                  >
                    <Icon name="close" size={18} color={c.inkSubtle} />
                  </Pressable>
                  <Stepper value={line.quantity} onChange={(next) => onQuantity(index, next)} />
                </View>
              </View>
            </Card>
          ))}

          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.secondarySoft,
              }}
            >
              <Icon name="pin" size={19} color={c.secondary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Overline size={10} color={c.secondary}>
                Pickup location
              </Overline>
              <Label size={14} numberOfLines={1}>
                {shop ? shop.name : "Not chosen yet"}
              </Label>
              {shop ? (
                <Body size={12.5} numberOfLines={1}>
                  {[shop.address, shop.city].filter(Boolean).join(", ")}
                </Body>
              ) : null}
            </View>
            <Pressable onPress={onChangeShop} onPressIn={haptics.tap} hitSlop={10}>
              <Label size={13.5} color={c.brand}>
                Change
              </Label>
            </Pressable>
          </Card>

          <Card style={{ gap: 10 }}>
            <Row label="Subtotal" value={formatMoney(totals.subtotalCents, totals.currency)} />
            <Row label="HST 13%" value={formatMoney(taxOn(totals.subtotalCents), totals.currency)} />
            <View style={{ height: 1, backgroundColor: c.border, marginVertical: 2 }} />
            <Row
              label="Total"
              strong
              value={formatMoney(
                totals.subtotalCents + taxOn(totals.subtotalCents),
                totals.currency,
              )}
            />
          </Card>

          <Body size={12} color={c.inkSubtle} style={{ textAlign: "center", paddingHorizontal: 12 }}>
            Party trays are pickup only — they travel best in your own hands.
          </Body>
        </View>
      )}
    </ScrollView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      {strong ? <Label size={15.5}>{label}</Label> : <Overline>{label}</Overline>}
      <Tabular size={strong ? 16 : 15}>{value}</Tabular>
    </View>
  );
}
