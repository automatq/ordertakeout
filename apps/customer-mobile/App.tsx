import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import type { MenuProduct } from "./src/api";
import { Menu } from "./src/screens/Menu";
import { Product } from "./src/screens/Product";
import { theme } from "./src/theme";

/**
 * The customer app, so far: the menu and one product.
 *
 * Checkout is deliberately absent rather than half-built. It needs a Square
 * sandbox application id we do not have and a release build on a physical
 * device to prove the card sheet works on the New Architecture — and the plan's
 * own sequencing puts it last for that reason. Screens that cannot honestly
 * finish a purchase say so instead of offering a button that does nothing.
 */
export default function App() {
  const [product, setProduct] = useState<MenuProduct | null>(null);
  /* No pickup shop chosen yet, so stock is reported as unknown throughout. The
     location picker is the next screen; until then the app is honest about not
     knowing rather than guessing. */
  const [locationId] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {product ? (
        <Product product={product} onBack={() => setProduct(null)} />
      ) : (
        <Menu locationId={locationId} onOpen={setProduct} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas },
});
