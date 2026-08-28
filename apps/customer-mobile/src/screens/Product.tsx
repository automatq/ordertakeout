import { Pressable, ScrollView, View } from "react-native";

import { formatMoney, type MenuProduct } from "../api";
import { formatTime } from "../format";
import * as haptics from "../haptics";
import { radius, useTheme } from "../theme";
import { Badge, Card, RoundButton, Stepper } from "../ui/controls";
import { Photo } from "../ui/photo";
import { Icon } from "../ui/icons";
import { useCtaSpace } from "../ui/chrome";
import { Body, Display, Label, Overline } from "../ui/text";

/**
 * One tray.
 *
 * A phone has one column, so ordering has to do the work a layout used to.
 * Price and size first, because that is the decision; allergens next, because
 * for some people that *is* the decision; prose last.
 */
export function Product({
  product,
  variantId,
  quantity,
  onPick,
  onQuantity,
  onBack,
}: {
  product: MenuProduct;
  variantId: string;
  quantity: number;
  onPick: (variantId: string) => void;
  onQuantity: (quantity: number) => void;
  onBack: () => void;
}) {
  /* Selection lives in the shell rather than here, because the button that acts
     on it is the sticky bar outside this screen. Keeping it local would mean
     the bar could not see what it was adding. */
  const { c } = useTheme();
  const chrome = useCtaSpace();
  const chosen = product.variants.find((v) => v.id === variantId) ?? product.variants[0];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 + chrome }}>
        <View>
          {product.imageUrl ? (
            <Photo
              uri={product.imageUrl}
              style={{ width: "100%", height: 280, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }}
            />
          ) : (
            <View
              style={{
                width: "100%",
                height: 280,
                backgroundColor: c.surfaceSunken,
                borderBottomLeftRadius: 30,
                borderBottomRightRadius: 30,
              }}
            />
          )}
          <View style={{ position: "absolute", top: 14, left: 18 }}>
            <RoundButton icon="arrowLeft" label="Back" onPress={onBack} overlay />
          </View>
          <View style={{ position: "absolute", bottom: 22, left: 20 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                paddingHorizontal: 13,
                paddingVertical: 6,
                borderRadius: radius.chip,
                backgroundColor: "rgba(255,196,70,0.94)",
              }}
            >
              <Icon name="clock" size={14} color="#4a3208" strokeWidth={2} />
              <Overline size={11} color="#4a3208">
                Order by {formatTime(product.orderCutoffTime)}
              </Overline>
            </View>
          </View>
        </View>

        <View style={{ padding: 20, paddingTop: 22 }}>
          <Display size={44}>{product.name}</Display>
          {product.description ? (
            <Body size={14.5} style={{ marginTop: 12 }}>
              {product.description}
            </Body>
          ) : null}

          {/* Never "free from": an empty list means the shop has not said, which
              is a different thing entirely and is printed as such. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
            {product.allergens.length > 0 ? (
              product.allergens.map((allergen) => (
                <Badge
                  key={allergen}
                  label={`Contains ${allergen}`}
                  tint={c.inkMuted}
                  background={c.surfaceSunken}
                  border={c.borderStrong}
                />
              ))
            ) : (
              <Badge
                label="Allergens not listed — ask in the shop"
                tint={c.inkMuted}
                background={c.surfaceSunken}
                border={c.borderStrong}
              />
            )}
            {product.dietaryTags.map((tag) => (
              <Badge key={tag} label={tag} tint={c.inkMuted} background={c.surfaceSunken} border={c.borderStrong} />
            ))}
          </View>

          <Overline style={{ marginTop: 26 }}>Choose a size</Overline>
          <View style={{ gap: 9, marginTop: 11 }} accessibilityRole="radiogroup">
            {product.variants.map((variant) => {
              const on = variant.id === chosen?.id;
              const soldOut = variant.available === false;
              return (
                <Pressable
                  key={variant.id}
                  onPress={() => onPick(variant.id)}
                  onPressIn={haptics.select}
                  disabled={soldOut}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: soldOut }}
                  accessibilityLabel={variant.name}
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 14,
                      padding: 14,
                      borderWidth: 2,
                      borderRadius: radius.control,
                      borderColor: on ? c.brand : c.border,
                      backgroundColor: on ? c.brandTint : c.surface,
                    },
                    soldOut && { opacity: 0.55 },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Label size={14.5}>{variant.name}</Label>
                    <Body size={11.5} color={c.inkSubtle} style={{ marginTop: 2 }}>
                      {soldOut
                        ? "Sold out today"
                        : variant.available === null
                          ? "Choose a shop to check stock"
                          : "Available today"}
                    </Body>
                  </View>
                  <Display size={26} color={c.brand}>
                    {formatMoney(variant.priceCents, variant.currency)}
                  </Display>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 22 }}>
            <Overline>Quantity</Overline>
            <Stepper value={quantity} onChange={onQuantity} />
          </View>

          <Card style={{ flexDirection: "row", gap: 12, marginTop: 22, backgroundColor: c.surfaceSunken }}>
            <Icon name="calendar" size={19} color={c.secondary} />
            <Body size={12.5} style={{ flex: 1 }}>
              Baked to order, so we need {product.leadTimeDays === 1 ? "a day" : `${product.leadTimeDays} days`}
              {" "}notice. Order before {formatTime(product.orderCutoffTime)} today and the earliest pickup is
              {product.leadTimeDays === 1 ? " tomorrow" : ` in ${product.leadTimeDays} days`}.
            </Body>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

/** What the sticky bar should say for the current selection. */
export function addLabel(product: MenuProduct, variantId: string, quantity: number) {
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  if (!variant) return { label: "Add to order", value: "", disabled: true };
  return {
    label: "Add to order",
    value: formatMoney(variant.priceCents * quantity, variant.currency),
    disabled: variant.available === false,
  };
}
