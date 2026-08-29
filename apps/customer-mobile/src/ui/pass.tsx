import type { ReactNode } from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { radius, useTheme } from "../theme";
import { Sheet } from "./chrome";
import { BrandWash } from "./gradient";
import { Body, Display, Overline } from "./text";
import { Perforation } from "./ticket";

/**
 * The thing you hold up at the counter.
 *
 * Everything it renders comes from a stored copy of the order, so it works with
 * the phone in aeroplane mode — which is roughly what a basement bakery counter
 * amounts to. `details` is whatever the surrounding screen wants below the
 * hairline; the confirmation puts the pickup time and branch there and the
 * tracker leaves it empty.
 */
export function PickupPass({
  orderNumber,
  pass,
  details,
}: {
  orderNumber: string;
  pass: string;
  details?: ReactNode;
}) {
  const { c } = useTheme();

  return (
    <Sheet>
      <View style={{ paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16, alignItems: "center" }}>
        <BrandWash cx={0.3} cy={0} mid={0.6} />
        <Overline size={10} color="rgba(255,255,255,0.85)">
          Pickup pass
        </Overline>
        <Display size={40} color="#ffffff" style={{ marginTop: 6, letterSpacing: 40 * 0.06 }}>
          {orderNumber}
        </Display>
      </View>

      <Perforation />

      <View style={{ alignItems: "center", gap: 16, paddingHorizontal: 22, paddingBottom: 22 }}>
        {/* True white behind the modules, not the surface token — a scanner
            needs the contrast and a tint costs read reliability. */}
        <View style={{ backgroundColor: "#ffffff", padding: 14, borderRadius: radius.control }}>
          <QRCode value={pass} size={188} backgroundColor="#ffffff" />
        </View>
        <Body size={12.5} style={{ textAlign: "center" }}>
          Show this at the counter. Staff scan it and confirm your name before handing the trays
          over. Works without signal.
        </Body>
        {details ? (
          <>
            <View style={{ width: "100%", height: 1, backgroundColor: c.border }} />
            <View style={{ width: "100%", gap: 11 }}>{details}</View>
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

/** One line of the pass's footer: an icon in a tinted disc, then the fact. */
export function PassDetail({
  icon,
  background,
  children,
}: {
  icon: ReactNode;
  background: string;
  children: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: background,
        }}
      >
        {icon}
      </View>
      <Body size={13.5} color={c.ink} style={{ flex: 1 }}>
        {children}
      </Body>
    </View>
  );
}
