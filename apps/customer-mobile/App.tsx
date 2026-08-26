import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";

import type { MenuProduct, PickupShop } from "./src/api";
import { loadChosenShop, saveChosenShop } from "./src/chosen-shop";
import { parseDeepLink } from "./src/deep-link";
import { Menu } from "./src/screens/Menu";
import { Order } from "./src/screens/Order";
import { Product } from "./src/screens/Product";
import { Shops } from "./src/screens/Shops";
import { loadSavedOrder } from "./src/saved-order";
import { theme } from "./src/theme";

/**
 * The customer app: choose a shop, browse the menu, and hold up the code that
 * collects your order.
 *
 * Checkout is deliberately absent rather than half-built. It needs a Square
 * sandbox application id we do not have and a release build on a physical
 * device to prove the card sheet works on the New Architecture — the plan's own
 * sequencing puts it last for that reason. Screens that cannot honestly finish a
 * purchase say so instead of offering a button that does nothing.
 */

type Screen = "shops" | "menu";
interface OpenOrder {
  orderNumber: string;
  accessKey: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [product, setProduct] = useState<MenuProduct | null>(null);
  const [order, setOrder] = useState<OpenOrder | null>(null);
  const [savedOrderNumber, setSavedOrderNumber] = useState<string | null>(null);

  const openFromUrl = useCallback((url: string) => {
    const destination = parseDeepLink(url);
    if (destination) {
      setProduct(null);
      setOrder({ orderNumber: destination.orderNumber, accessKey: destination.accessKey });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [stored, savedOrder, initialUrl] = await Promise.all([
        loadChosenShop(),
        loadSavedOrder(),
        /* The link that launched the app, if any — a cold start from an email
           arrives here rather than through the listener below. */
        Linking.getInitialURL(),
      ]);
      if (!active) return;

      setShopId(stored);
      setSavedOrderNumber(savedOrder?.orderNumber ?? null);
      setScreen(stored ? "menu" : "shops");
      if (initialUrl) openFromUrl(initialUrl);
    })();

    // A link tapped while the app is already open.
    const subscription = Linking.addEventListener("url", ({ url }) => openFromUrl(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [openFromUrl]);

  const choose = useCallback(async (shop: PickupShop) => {
    await saveChosenShop(shop.id);
    setShopId(shop.id);
    setScreen("menu");
  }, []);

  const openSavedOrder = useCallback(async () => {
    const saved = await loadSavedOrder();
    if (saved) setOrder({ orderNumber: saved.orderNumber, accessKey: saved.accessKey });
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
      {order ? (
        <Order
          orderNumber={order.orderNumber}
          accessKey={order.accessKey}
          onClose={() => setOrder(null)}
        />
      ) : screen === "shops" ? (
        <Shops chosenId={shopId} onChoose={choose} onSkip={() => setScreen("menu")} />
      ) : product ? (
        <Product product={product} onBack={() => setProduct(null)} />
      ) : (
        <Menu
          locationId={shopId}
          onOpen={setProduct}
          onChangeShop={() => setScreen("shops")}
          savedOrderNumber={savedOrderNumber}
          onOpenOrder={openSavedOrder}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center" },
});
