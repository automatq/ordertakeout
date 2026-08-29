import { Pressable, ScrollView, View } from "react-native";

import type { AvailabilityDay, PickupShop } from "../api";
import { formatDate, formatTime } from "../format";
import * as haptics from "../haptics";
import { radius, shadows, useTheme } from "../theme";
import { Card, Chip, RoundButton } from "../ui/controls";
import { Icon } from "../ui/icons";
import { useCtaSpace } from "../ui/chrome";
import { Skeleton } from "../ui/skeleton";
import { Body, Display, Label, Overline } from "../ui/text";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Read a store date without letting the device's timezone near it.
 *
 * These are bare calendar days. Handing "2026-08-28" to a Date and formatting it
 * locally can render the 27th, which is how somebody is told the wrong pickup
 * day — so the parts are read out in UTC, where no offset applies.
 */
function dayParts(date: string, today: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  const tomorrow = new Date(Date.UTC(...(today.split("-").map(Number) as [number, number, number])));
  tomorrow.setUTCMonth(tomorrow.getUTCMonth(), tomorrow.getUTCDate() + 1);
  const isTomorrow = utc.getTime() === tomorrow.getTime();
  return {
    weekday: isTomorrow ? "Tmrw" : WEEKDAYS[utc.getUTCDay()]!,
    day: String(utc.getUTCDate()),
    month: MONTHS[utc.getUTCMonth()]!,
  };
}

/**
 * When to collect.
 *
 * Days that are entirely unavailable are still shown, greyed — a customer
 * scanning for "next Saturday" needs to see that it is closed, not have it
 * quietly missing and wonder whether they scrolled past it.
 */
export function Pickup({
  shop,
  days,
  loading,
  unavailableReason,
  today,
  date,
  time,
  onPickDate,
  onPickTime,
  onBack,
  onChangeShop,
}: {
  shop: PickupShop | null;
  days: AvailabilityDay[];
  loading: boolean;
  unavailableReason: string | null;
  today: string;
  date: string | null;
  time: string | null;
  onPickDate: (date: string) => void;
  onPickTime: (time: string) => void;
  onBack: () => void;
  onChangeShop: () => void;
}) {
  const { c, scheme } = useTheme();
  const chrome = useCtaSpace();
  const sh = shadows(scheme);
  const chosenDay = days.find((d) => d.date === date) ?? null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 + chrome }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 18, paddingTop: 6 }}>
        <RoundButton icon="arrowLeft" label="Back" onPress={onBack} />
        <View>
          <Overline size={10}>Step 1 of 3</Overline>
          <Display size={38} style={{ marginTop: 2 }}>
            When suits you?
          </Display>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20 }}>
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
              <Overline size={9.5}>Collect from</Overline>
              <Label size={14}>{shop?.name ?? "Choose a shop"}</Label>
              {shop ? (
                <Body size={12.5} color={c.inkSubtle}>
                  {shop.address}
                  {shop.city ? `, ${shop.city}` : ""}
                </Body>
              ) : null}
            </View>
            <Icon name="chevronRight" size={16} color={c.inkSubtle} />
          </Card>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 14 }}>
          <Skeleton style={{ width: "35%", height: 14 }} />
          <View style={{ flexDirection: "row", gap: 9 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} style={{ width: 66, height: 74 }} />
            ))}
          </View>
          <Skeleton style={{ width: "45%", height: 14, marginTop: 10 }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} style={{ width: 92, height: 40, borderRadius: 999 }} />
            ))}
          </View>
        </View>
      ) : unavailableReason ? (
        <View style={{ padding: 20 }}>
          <Card style={{ backgroundColor: c.accentSoft, borderColor: c.accentInk + "38", gap: 4 }}>
            <Label size={14.5} color={c.accentInk}>
              Can't take this order right now
            </Label>
            <Body size={13} color={c.accentInk}>
              {unavailableReason}
            </Body>
          </Card>
        </View>
      ) : (
        <>
          <Overline style={{ paddingHorizontal: 20, marginTop: 24 }}>Pickup date</Overline>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 9, paddingHorizontal: 20, paddingTop: 11, paddingBottom: 4 }}
          >
            {days.map((day) => {
              const parts = dayParts(day.date, today);
              const on = day.date === date;
              const closed = !day.hasAvailability;
              return (
                <Pressable
                  key={day.date}
                  onPress={() => onPickDate(day.date)}
                  onPressIn={haptics.select}
                  disabled={closed}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: closed }}
                  accessibilityLabel={`${parts.weekday} ${parts.month} ${parts.day}${closed ? ", closed" : ""}`}
                  style={({ pressed }) => [
                    {
                      width: 66,
                      paddingVertical: 12,
                      borderRadius: radius.control,
                      borderWidth: 2,
                      alignItems: "center",
                      gap: 2,
                      borderColor: closed ? c.border : on ? c.brand : c.borderStrong,
                      backgroundColor: closed ? c.surfaceSunken : on ? c.brand : c.surface,
                    },
                    on && !closed ? sh.brand : sh.card,
                    closed && { opacity: 0.6 },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Body size={11} color={on && !closed ? c.brandInk : c.inkSubtle}>
                    {parts.weekday}
                  </Body>
                  <Display size={24} color={on && !closed ? c.brandInk : c.ink}>
                    {parts.day}
                  </Display>
                  <Body size={10.5} color={on && !closed ? c.brandInk : c.inkSubtle}>
                    {closed ? "Closed" : parts.month}
                  </Body>
                </Pressable>
              );
            })}
          </ScrollView>

          <Overline style={{ paddingHorizontal: 20, marginTop: 24 }}>
            {chosenDay ? `Pickup time — ${formatDate(chosenDay.date, today)}` : "Pickup time"}
          </Overline>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9, paddingHorizontal: 20, paddingTop: 11 }}>
            {chosenDay ? (
              chosenDay.slots.map((slot) => (
                <Chip
                  key={slot.time}
                  label={formatTime(slot.time)}
                  selected={time === slot.time}
                  disabled={!slot.available}
                  note={slot.available ? undefined : slot.reason ?? undefined}
                  onPress={() => onPickTime(slot.time)}
                />
              ))
            ) : (
              <Body size={13.5}>Pick a day first.</Body>
            )}
          </View>

          {/* Only shown when it is genuinely tight — a count on every slot would
              turn into wallpaper and stop meaning anything. */}
          {chosenDay && time
            ? (() => {
                const slot = chosenDay.slots.find((s) => s.time === time);
                if (!slot?.available || slot.remaining === null || slot.remaining > 3) return null;
                return (
                  <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
                    <Card style={{ backgroundColor: c.accentSoft, borderColor: c.accentInk + "38" }}>
                      <Body size={12.5} color={c.accentInk}>
                        Only {slot.remaining} order{slot.remaining === 1 ? "" : "s"} left at this time.
                      </Body>
                    </Card>
                  </View>
                );
              })()
            : null}
          {/* Says out loud why unavailable times are still on screen. Hiding
              them looks like the shop simply does not open then. */}
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <Card
              style={{
                flexDirection: "row",
                gap: 11,
                backgroundColor: c.surfaceSunken,
              }}
            >
              <View style={{ paddingTop: 1 }}>
                <Icon name="info" size={17} color={c.secondary} />
              </View>
              <Body size={12} style={{ flex: 1 }}>
                We hold your slot for 10 minutes while you pay. Unavailable times are shown so you
                can see what&rsquo;s left, not hidden.
              </Body>
            </Card>
          </View>
        </>
      )}
    </ScrollView>
  );
}
