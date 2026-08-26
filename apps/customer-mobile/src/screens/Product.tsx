import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { formatMoney, type MenuProduct, type MenuVariant } from "../api";
import { formatTime } from "../format";
import { theme } from "../theme";

/**
 * One product, and the honest version of whether it can be had.
 *
 * The web page carries the same information; what changes here is that a phone
 * has one column, so the ordering has to do the work a layout used to. Price and
 * availability first, because that is the decision. Allergens next, because for
 * some people that is the decision. Prose last.
 */
export function Product({ product, onBack }: { product: MenuProduct; onBack: () => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backRow}>
        <Text style={styles.back}>← Menu</Text>
      </Pressable>

      {product.imageUrl ? (
        <Image source={{ uri: product.imageUrl }} style={styles.hero} resizeMode="cover" />
      ) : null}

      <Text style={styles.title}>{product.name}</Text>

      <View style={styles.variants}>
        {product.variants.map((variant) => (
          <VariantRow key={variant.id} variant={variant} />
        ))}
      </View>

      {/* Never "free from" — an empty list means the shop has not said, which is
          not the same as safe, and the difference matters enormously here. */}
      {product.allergens.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Contains</Text>
          <Text style={styles.blockBody}>{product.allergens.join(", ")}</Text>
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Allergens</Text>
          <Text style={styles.blockBody}>
            Not listed. Ask in the shop if you need to be sure.
          </Text>
        </View>
      )}

      {product.dietaryTags.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Suitable for</Text>
          <Text style={styles.blockBody}>{product.dietaryTags.join(", ")}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.blockTitle}>Ordering</Text>
        <Text style={styles.blockBody}>
          {product.leadTimeDays > 0
            ? `Order at least ${product.leadTimeDays} day${product.leadTimeDays === 1 ? "" : "s"} ahead, by ${formatTime(product.orderCutoffTime)} on the day you order.`
            : `Order by ${formatTime(product.orderCutoffTime)} on the day you order.`}
        </Text>
      </View>

      {product.description ? (
        <View style={styles.block}>
          <Text style={styles.blockBody}>{product.description}</Text>
        </View>
      ) : null}

      {/* Checkout is not built yet, and the app says so rather than offering a
          button that does nothing. */}
      <Text style={styles.footnote}>
        Ordering in the app is coming. For now you can order on the website.
      </Text>
    </ScrollView>
  );
}

function VariantRow({ variant }: { variant: MenuVariant }) {
  return (
    <View style={styles.variantRow}>
      <View style={styles.variantBody}>
        <Text style={styles.variantName}>{variant.name}</Text>
        {variant.available === false ? (
          <Text style={styles.soldOut}>Sold out today</Text>
        ) : variant.available === null ? (
          /* Unknown is said out loud rather than shown as available. */
          <Text style={styles.unknown}>Choose a shop to check stock</Text>
        ) : null}
      </View>
      <Text style={[styles.variantPrice, variant.available === false && styles.faded]}>
        {formatMoney(variant.priceCents, variant.currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 16 },
  backRow: { alignSelf: "flex-start" },
  back: { color: theme.brand, fontWeight: "600", fontSize: 16 },
  hero: { width: "100%", height: 220, borderRadius: 20, backgroundColor: theme.surface },
  title: { fontSize: 28, fontWeight: "700", color: theme.ink },
  variants: { backgroundColor: theme.surface, borderRadius: 20, padding: 4 },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  variantBody: { flex: 1 },
  variantName: { fontSize: 16, color: theme.ink },
  variantPrice: { fontSize: 16, fontWeight: "700", color: theme.ink },
  faded: { color: theme.inkSubtle },
  soldOut: { fontSize: 13, fontWeight: "600", color: theme.danger, marginTop: 2 },
  unknown: { fontSize: 13, color: theme.inkSubtle, marginTop: 2 },
  block: { gap: 4 },
  blockTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  blockBody: { fontSize: 15, color: theme.inkMuted, lineHeight: 22 },
  footnote: {
    fontSize: 14,
    color: theme.inkMuted,
    backgroundColor: theme.surface,
    padding: 14,
    borderRadius: 14,
    lineHeight: 20,
  },
});
