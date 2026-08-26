import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import type { MenuProduct, PickupShop } from "./src/api";
import { loadChosenShop, saveChosenShop } from "./src/chosen-shop";
import { Menu } from "./src/screens/Menu";
import { Product } from "./src/screens/Product";
import { Shops } from "./src/screens/Shops";
import { theme } from "./src/theme";

/**
 * The customer app, so far: choose a shop, browse the menu, open a product.
 *
 * Checkout is deliberately absent rather than half-built. It needs a Square
 * sandbox application id we do not have and a release build on a physical
 * device to prove the card sheet works on the New Architecture — and the plan's
 * own sequencing puts it last for that reason. Screens that cannot honestly
 * finish a purchase say so instead of offering a button that does nothing.
 */

type Screen = "shops" | "menu";

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [product, setProduct] = useState<MenuProduct | null>(null);

  useEffect(() => {
    let active = true;
    void loadChosenShop().then((stored) => {
      if (!active) return;
      setShopId(stored);
      /* Somebody who has already chosen goes straight to the food. Asking again
         every launch would be asking a question we already know the answer to. */
      setScreen(stored ? "menu" : "shops");
    });
    return () => {
      active = false;
    };
  }, []);

  const choose = useCallback(async (shop: PickupShop) => {
    await saveChosenShop(shop.id);
    setShopId(shop.id);
    setScreen("menu");
  }, []);

  if (screen === null) {
    return (
      <View style={styles.centre}>
        <StatusBar style="dark" />
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {screen === "shops" ? (
        <Shops chosenId={shopId} onChoose={choose} onSkip={() => setScreen("menu")} />
      ) : product ? (
        <Product product={product} onBack={() => setProduct(null)} />
      ) : (
        <Menu
          locationId={shopId}
          onOpen={setProduct}
          onChangeShop={() => setScreen("shops")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center" },
});
