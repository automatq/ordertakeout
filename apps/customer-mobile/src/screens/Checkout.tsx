import { Pressable, ScrollView, TextInput, View } from "react-native";

import { formatMoney, type PickupShop } from "../api";
import type { CartTotals } from "../cart";
import { formatTime } from "../format";
import { radius, useTheme } from "../theme";
import { Button, Card, Chip, RoundButton } from "../ui/controls";
import { Icon } from "../ui/icons";
import { useCtaSpace } from "../ui/chrome";
import { Body, Display, Label, Overline } from "../ui/text";

/** Ontario HST, matching the storefront's own arithmetic. */
const TAX_RATE = 0.13;
const TIPS = [0, 10, 15, 20];

export function taxOn(subtotalCents: number) {
  return Math.round(subtotalCents * TAX_RATE);
}
export function tipOn(subtotalCents: number, percent: number) {
  return Math.round(subtotalCents * (percent / 100));
}

/**
 * Pay and confirm.
 *
 * The last step, and the one that cannot yet finish: taking a card needs a
 * Square application id this build does not have, and the card sheet has to be
 * proved on a physical device on the New Architecture before it can be trusted
 * with money. So the screen is complete and the button says exactly what is
 * missing, rather than presenting a control that would fail on tap.
 */
export function Checkout({
  totals,
  shop,
  date,
  time,
  tip,
  name,
  phone,
  email,
  onTip,
  onName,
  onPhone,
  onEmail,
  onPay,
  paying,
  payError,
  onBack,
  onPlaced,
  paymentBlocked,
}: {
  totals: CartTotals;
  shop: PickupShop | null;
  date: string | null;
  time: string | null;
  tip: number;
  name: string;
  phone: string;
  email: string;
  onTip: (percent: number) => void;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onEmail: (value: string) => void;
  onPay: () => void;
  paying: boolean;
  payError: string | null;
  onBack: () => void;
  /**
   * Called with the placed order once payment succeeds.
   *
   * Nothing calls it yet — the pay buttons below are inert until there is a
   * Square application id — but this is the seam: it is what takes the customer
   * to the confirmation and its pickup pass.
   */
  onPlaced: (order: { orderNumber: string; accessKey: string }) => void;
  /** Why payment cannot run here, or null once it can. */
  paymentBlocked: string | null;
}) {
  const { c } = useTheme();
  const chrome = useCtaSpace();
  /* The server validates all three properly; this only decides whether the
     button is worth offering yet. */
  const ready = name.trim().length > 0 && phone.trim().length > 0 && email.trim().includes("@");
  const tax = taxOn(totals.subtotalCents);
  const tipCents = tipOn(totals.subtotalCents, tip);

  const field = {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.control,
    backgroundColor: c.surfaceSunken,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.ink,
  } as const;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 24 + chrome }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 18, paddingTop: 6 }}>
        <RoundButton icon="arrowLeft" label="Back" onPress={onBack} />
        <View>
          <Overline size={10.5}>Step 3 of 3</Overline>
          <Display size={38}>Pay &amp; confirm</Display>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, gap: 16 }}>
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
            <Icon name="calendar" size={18} color={c.accentInk} />
            <Body size={13.5} color={c.ink}>
              {date && time ? `${date} at ${formatTime(time)}` : "No pickup time chosen"}
            </Body>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
            <Icon name="pin" size={18} color={c.secondary} />
            <Body size={13.5} color={c.ink} style={{ flex: 1 }}>
              {shop ? `${shop.name}, ${shop.address}` : "No shop chosen"}
            </Body>
          </View>
        </Card>

        <View>
          <Overline>Your details</Overline>
          <View style={{ gap: 9, marginTop: 11 }}>
            <TextInput
              value={name}
              onChangeText={onName}
              placeholder="Name for the order"
              placeholderTextColor={c.inkSubtle}
              autoComplete="name"
              style={field}
              accessibilityLabel="Name for the order"
            />
            <TextInput
              value={phone}
              onChangeText={onPhone}
              placeholder="Mobile number"
              placeholderTextColor={c.inkSubtle}
              keyboardType="phone-pad"
              autoComplete="tel"
              style={field}
              accessibilityLabel="Mobile number"
            />
            {/* Required by the order itself, not just for the receipt: an order
                is looked up by number *and* email, so a checkout without one
                would create a record its owner could never reopen. */}
            <TextInput
              value={email}
              onChangeText={onEmail}
              placeholder="Email for the receipt"
              placeholderTextColor={c.inkSubtle}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
              style={field}
              accessibilityLabel="Email for the receipt"
            />
          </View>
          <Body size={12.5} color={c.inkSubtle} style={{ marginTop: 8 }}>
            We text a pickup reminder the morning of your collection.
          </Body>
        </View>

        <View>
          <Overline>Add a tip for the bakers</Overline>
          <View style={{ flexDirection: "row", gap: 9, marginTop: 11 }}>
            {TIPS.map((percent) => (
              <Chip
                key={percent}
                label={percent === 0 ? "No tip" : `${percent}%`}
                selected={tip === percent}
                onPress={() => onTip(percent)}
              />
            ))}
          </View>
        </View>

        <View>
          <Overline>Payment</Overline>
          <View style={{ gap: 9, marginTop: 11 }}>
            {/* Apple Pay stays inert: it needs a merchant identifier and a
                real payment sheet, neither of which a simulated charge has. */}
            <Button label="Apple Pay" variant="secondary" disabled icon="card" />
            <Body size={12.5} color={c.inkSubtle} style={{ textAlign: "center" }}>
              or pay by card
            </Body>
            <Button
              label={paying ? "Taking payment…" : "Pay by card"}
              variant="primary"
              icon="card"
              busy={paying}
              disabled={!!paymentBlocked || !ready}
              onPress={onPay}
            />
            {!paymentBlocked && !ready ? (
              <Body size={12.5} color={c.inkSubtle} style={{ textAlign: "center" }}>
                Add your name, mobile number and email to pay.
              </Body>
            ) : null}
            {payError ? (
              <Card style={{ backgroundColor: c.dangerSoft, borderColor: `${c.danger}59` }}>
                <Body size={12.5} color={c.danger}>
                  {payError}
                </Body>
              </Card>
            ) : null}
          </View>

          {/* Worth the line: "where does my card number go" is the question that
              stops people paying in an app they installed yesterday. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: 10,
            }}
          >
            <Icon name="lock" size={14} color={c.inkSubtle} />
            <Body size={11.5} color={c.inkSubtle}>
              Card details go straight to Square. We never see them.
            </Body>
          </View>

          {paymentBlocked ? (
            <Card style={{ marginTop: 12, backgroundColor: c.accentSoft, borderColor: c.accentInk + "38", gap: 4 }}>
              <Label size={13.5} color={c.accentInk}>
                Card payments aren't switched on yet
              </Label>
              <Body size={12.5} color={c.accentInk}>
                {paymentBlocked}
              </Body>
            </Card>
          ) : null}
        </View>

        <Card style={{ gap: 9 }}>
          <Row label="Subtotal" value={formatMoney(totals.subtotalCents, totals.currency)} />
          <Row label="HST 13%" value={formatMoney(tax, totals.currency)} />
          {tipCents > 0 ? <Row label={`Tip ${tip}%`} value={formatMoney(tipCents, totals.currency)} /> : null}
          <View style={{ height: 1, backgroundColor: c.border, marginVertical: 3 }} />
          <Row label="Total" value={formatMoney(totals.subtotalCents + tax + tipCents, totals.currency)} strong />
        </Card>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Body size={14} color={strong ? c.ink : c.inkMuted}>
        {label}
      </Body>
      <Label size={strong ? 16 : 14} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Label>
    </View>
  );
}
