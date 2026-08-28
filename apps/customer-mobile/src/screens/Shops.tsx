import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { fetchShops, type PickupShop } from "../api";
import { formatTime } from "../format";
import * as haptics from "../haptics";
import { radius, useTheme } from "../theme";
import { Button, Card } from "../ui/controls";
import { Body, Display, Label } from "../ui/text";

const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * Today's opening hours, in the device's own reckoning of what day it is.
 *
 * Deliberately not a pickup-date calculation — those are store-local and stay
 * strings. This is "what day is it where you are standing", which is the right
 * question for someone deciding whether to walk over.
 */
function todayHours(shop: PickupShop): string {
  const key = DAY_KEYS[new Date().getDay()];
  const period = shop.hours.find((entry) => entry.dayOfWeek.toUpperCase().startsWith(key ?? ""));
  if (!period) return "Closed today";
  return `Open today ${formatTime(period.startTime)} – ${formatTime(period.endTime)}`;
}

/** Where to collect from — the first thing the app asks, and skippable. */
export function Shops({
  chosenId,
  onChoose,
  onSkip,
}: {
  chosenId: string | null;
  onChoose: (shop: PickupShop) => void;
  onSkip: () => void;
}) {
  const { c } = useTheme();
  const [shops, setShops] = useState<PickupShop[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchShops();
    if (result.ok) {
      setShops(result.data.shops);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!shops) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
        {error ? (
          <>
            <Body size={15} color={c.ink} style={{ textAlign: "center" }}>
              {error}
            </Body>
            <Button label="Try again" onPress={load} />
            {/* Never a dead end: the menu works without a shop. */}
            <Pressable onPress={onSkip} onPressIn={haptics.tap} hitSlop={10}>
              <Label color={c.brand}>See the menu anyway</Label>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={c.brand} />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 24, gap: 12 }}>
      <Display size={38}>Where will you collect?</Display>
      <Body size={15} style={{ marginTop: -4, marginBottom: 6 }}>
        We'll show you what's in stock there. You can change this any time.
      </Body>

      {shops.map((shop) => (
        <Pressable
          key={shop.id}
          onPress={() => onChoose(shop)}
          onPressIn={haptics.select}
          accessibilityRole="button"
          accessibilityLabel={shop.name}
          style={({ pressed }) => [pressed && { opacity: 0.9 }]}
        >
          <Card
            style={{
              gap: 3,
              padding: 18,
              borderWidth: 2,
              borderColor: shop.id === chosenId ? c.brand : c.border,
              borderRadius: radius.card,
            }}
          >
            <Label size={17}>{shop.name}</Label>
            <Body size={15}>
              {shop.address}
              {shop.city ? `, ${shop.city}` : ""}
            </Body>
            <Body size={14} color={c.inkSubtle} style={{ marginTop: 2 }}>
              {todayHours(shop)}
            </Body>
          </Card>
        </Pressable>
      ))}

      <Pressable onPress={onSkip} onPressIn={haptics.tap} hitSlop={10} style={{ paddingVertical: 10 }}>
        <Label color={c.brand} style={{ textAlign: "center" }}>
          Just browsing
        </Label>
      </Pressable>
    </ScrollView>
  );
}
