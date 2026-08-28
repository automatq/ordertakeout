import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import {
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from "@expo-google-fonts/poppins";

import {
  fetchAvailability,
  fetchMenu,
  fetchShops,
  formatMoney,
  type AvailabilityDay,
  type Menu as MenuData,
  type MenuProduct,
  type PickupShop,
} from "./src/api";
import {
  addLine,
  removeLine,
  resolveCart,
  setQuantity,
  toAvailabilityCart,
  type CartLine,
} from "./src/cart";
import { loadChosenShop, saveChosenShop } from "./src/chosen-shop";
import { clearAccountToken, loadAccountToken, saveAccountToken } from "./src/account-session";
import { parseDeepLink } from "./src/deep-link";
import { loadSavedOrder } from "./src/saved-order";
import { Account } from "./src/screens/Account";
import { Cart } from "./src/screens/Cart";
import { Checkout, taxOn, tipOn } from "./src/screens/Checkout";
import { Confirm } from "./src/screens/Confirm";
import { Home } from "./src/screens/Home";
import { Menu } from "./src/screens/Menu";
import { Pickup } from "./src/screens/Pickup";
import { Product } from "./src/screens/Product";
import { Shops } from "./src/screens/Shops";
import { SignIn } from "./src/screens/SignIn";
import { Track } from "./src/screens/Track";
import { ThemeProvider, useTheme } from "./src/theme";
import { StickyCta, TabBar, Toast } from "./src/ui/chrome";
import { BlurTargetProvider, BlurTargetSurface } from "./src/ui/glass";
import { ErrorBoundary } from "./src/ui/error-boundary";
import { ScreenTransition } from "./src/ui/transition";

void SplashScreen.preventAutoHideAsync();

/**
 * Harina Bakeshoppe.
 *
 * Ten screens from the design, on a flat state machine rather than a router.
 * expo-router does not currently compile on Expo SDK 57 — it pulls reanimated
 * 4.6, which needs worklets 0.12, while the expo-modules-core shipped with the
 * same SDK is written against <=0.10 and fails on `executeSync`. The reasoning
 * and the retry condition are in the staff app's README; this shell is what
 * works today.
 *
 * Checkout stops short of taking money, deliberately and visibly: that needs a
 * Square application id this build does not have, and the card sheet has to be
 * proved on a physical device on the New Architecture first.
 */

const PAYMENT_BLOCKED =
  "This build has no Square application id, and the card sheet still has to be proved on a real " +
  "device. Everything up to payment works — you can pick trays, a shop and a time.";

type Screen =
  | "home"
  | "menu"
  | "product"
  | "cart"
  | "pickup"
  | "checkout"
  | "confirm"
  | "track"
  | "account"
  | "shops"
  | "signin";

/** Screens that keep the tab bar; the ordering path takes over the bottom edge. */
const TABBED: Screen[] = ["home", "menu", "track", "account"];

function Shell() {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const [screen, setScreen] = useState<Screen | null>(null);
  /* The confirmation screen and the pickup pass are the same screen wearing two
     faces — see src/screens/Confirm.tsx. */
  const [confirmMode, setConfirmMode] = useState<"confirmation" | "pass">("pass");
  /* Which shelf the menu should open on. Cleared by every other route into it,
     so arriving from the tab bar never lands on a filter you set yesterday. */
  const [menuCategory, setMenuCategory] = useState<string | null>(null);
  const [shop, setShop] = useState<PickupShop | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);

  const [menu, setMenu] = useState<MenuData | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [product, setProduct] = useState<MenuProduct | null>(null);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity_] = useState(1);
  const [toast, setToast] = useState<string | null>(null);

  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsReason, setSlotsReason] = useState<string | null>(null);
  const [storeToday, setStoreToday] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const [tip, setTip] = useState(15);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [accountToken, setAccountToken] = useState<string | null>(null);
  const [order, setOrder] = useState<{ orderNumber: string; accessKey: string } | null>(null);

  const products = useMemo(() => menu?.groups.flatMap((g) => g.products) ?? [], [menu]);
  const categories = useMemo(() => menu?.groups.map((g) => g.category) ?? [], [menu]);
  const totals = useMemo(() => resolveCart(cart, products), [cart, products]);

  const loadMenu = useCallback(
    async (locationId: string | null) => {
      const result = await fetchMenu(locationId);
      if (result.ok) {
        setMenu(result.data);
        setMenuError(null);
      } else {
        setMenuError(result.error);
      }
    },
    [],
  );

  const openFromUrl = useCallback((url: string) => {
    const destination = parseDeepLink(url);
    if (!destination) return;
    setOrder({ orderNumber: destination.orderNumber, accessKey: destination.accessKey });
    setScreen("track");
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [storedShop, token, saved, initialUrl] = await Promise.all([
        loadChosenShop(),
        loadAccountToken(),
        loadSavedOrder(),
        Linking.getInitialURL(),
      ]);
      if (!active) return;

      setShopId(storedShop);
      setAccountToken(token);
      if (saved) setOrder({ orderNumber: saved.orderNumber, accessKey: saved.accessKey });

      /* Resolve the stored id back to a shop. Only the id is kept — a name and
         address saved months ago could be wrong — so without this the header
         says "choose a shop" to somebody who already has one, while the menu
         is quietly scoped to it. */
      if (storedShop) {
        void fetchShops().then((result) => {
          if (!active || !result.ok) return;
          setShop(result.data.shops.find((s) => s.id === storedShop) ?? null);
        });
      }

      /* Not awaited. The menu is a network call with a ten-second timeout, and
         awaiting it here meant a cold launch with no signal sat on a static
         splash screen for the whole of it. Everything the first screen needs to
         draw itself has already been read from the device; the trays arrive
         into a skeleton. */
      void loadMenu(storedShop);

      setScreen(storedShop ? "home" : "shops");
      if (initialUrl) openFromUrl(initialUrl);
      void SplashScreen.hideAsync();
    })();

    const subscription = Linking.addEventListener("url", ({ url }) => openFromUrl(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [loadMenu, openFromUrl]);

  /* Refetched whenever the cart or shop changes, because a slot's availability
     depends on both — the same reason the storefront refetches it. */
  useEffect(() => {
    if (screen !== "pickup" || !shopId || totals.lines.length === 0) return;
    let active = true;
    setSlotsLoading(true);
    void fetchAvailability(shopId, toAvailabilityCart(totals.lines)).then((result) => {
      if (!active) return;
      setSlotsLoading(false);
      if (!result.ok) return setSlotsReason(result.error);

      const data = result.data;
      if (!data.available) return setSlotsReason(data.reason);

      setSlotsReason(null);
      setDays(data.days);
      setStoreToday(data.today);
      /* Land on the first day that can actually take the order rather than one
         the customer then has to discover is closed. */
      setDate((current) => current ?? data.days.find((day) => day.hasAvailability)?.date ?? null);
    });
    return () => {
      active = false;
    };
  }, [screen, shopId, totals.lines]);

  const chooseShop = useCallback(
    async (next: PickupShop) => {
      await saveChosenShop(next.id);
      setShop(next);
      setShopId(next.id);
      /* Stock and slots are both per-shop, so anything chosen against the old
         one is now a guess. */
      setDate(null);
      setTime(null);
      await loadMenu(next.id);
      setScreen("home");
    },
    [loadMenu],
  );

  const openMenu = useCallback(() => {
    setMenuCategory(null);
    setScreen("menu");
  }, []);

  const openProduct = useCallback((next: MenuProduct) => {
    setProduct(next);
    setVariantId(next.variants[0]?.id ?? "");
    setQuantity_(1);
    setScreen("product");
  }, []);

  const addToOrder = useCallback(() => {
    if (!product || !variantId) return;
    setCart((current) => addLine(current, product.id, variantId, quantity));
    const variant = product.variants.find((v) => v.id === variantId);
    setToast(`${quantity} × ${variant?.name ?? product.name} added`);
    setScreen("menu");
  }, [product, variantId, quantity]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * The Android back gesture, routed the same way the on-screen back buttons go.
   *
   * This app navigates by swapping one component for another rather than pushing
   * onto a native stack, so Android has nothing to pop and the system back
   * quits the app from wherever you are — including halfway through checkout,
   * with a full order in hand. Every screen that draws a back control resolves
   * here to the same place that control goes, so the two never disagree.
   *
   * Returning false is deliberate on home: leaving the app from the root is the
   * platform's behaviour, and swallowing it would trap people in the app.
   */
  useEffect(() => {
    const goBack = () => {
      switch (screen) {
        case null:
        case "home":
          return false;
        case "product":
        case "cart":
          openMenu();
          return true;
        case "pickup":
          setScreen("cart");
          return true;
        case "checkout":
          setScreen("pickup");
          return true;
        case "signin":
          setScreen("account");
          return true;
        default:
          /* menu, track, account, shops and confirm all sit one level under
             home — including confirm, which must not walk back into a checkout
             that has already been paid for. */
          setScreen("home");
          return true;
      }
    };

    const sub = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => sub.remove();
  }, [screen, openMenu]);

  if (screen === null) {
    return (
      <View style={{ flex: 1, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const tax = taxOn(totals.subtotalCents);
  const grandTotal = totals.subtotalCents + tax + tipOn(totals.subtotalCents, tip);

  const cta = (() => {
    if (screen === "product" && product) {
      const variant = product.variants.find((v) => v.id === variantId);
      return {
        label: "Add to order",
        value: variant ? formatMoney(variant.priceCents * quantity, variant.currency) : "",
        onPress: addToOrder,
        disabled: !variant || variant.available === false,
      };
    }
    if (screen === "cart") {
      return {
        /* Tax included, matching the cart's own total. The button carrying a
           smaller number than the panel above it reads as a discount that then
           fails to materialise. */
        label: "Choose pickup time",
        value: formatMoney(totals.subtotalCents + tax, totals.currency),
        onPress: () => setScreen(shopId ? "pickup" : "shops"),
        disabled: totals.lines.length === 0,
      };
    }
    if (screen === "pickup") {
      return {
        /* No money on this one: the step is about a time, and the price has not
           moved since the cart. The label carries the whole message instead. */
        label: date && time ? "Continue to payment" : "Pick a date and time",
        value: "",
        onPress: () => setScreen("checkout"),
        disabled: !date || !time,
      };
    }
    if (screen === "checkout") {
      return {
        label: "Pay now",
        value: formatMoney(grandTotal, totals.currency),
        onPress: undefined,
        disabled: true,
      };
    }
    return null;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <BlurTargetSurface style={{ flex: 1, paddingTop: insets.top }}>
        <ScreenTransition screenKey={screen}>
        {screen === "shops" ? (
          <Shops
            chosenId={shopId}
            onChoose={chooseShop}
            onSkip={() => setScreen("home")}
          />
        ) : screen === "signin" ? (
          <SignIn
            onSignedIn={async (token) => {
              await saveAccountToken(token);
              setAccountToken(token);
              setScreen("account");
            }}
            onCancel={() => setScreen("account")}
          />
        ) : screen === "home" ? (
          <Home
            shop={shop}
            products={products}
            categories={categories}
            loading={!menu && !menuError}
            orderNumber={order?.orderNumber ?? null}
            accessKey={order?.accessKey ?? null}
            onChangeShop={() => setScreen("shops")}
            onOpenProduct={openProduct}
            onOpenCategory={(category) => {
              setMenuCategory(category);
              setScreen("menu");
            }}
            onSeeAll={() => openMenu()}
            onTrack={() => setScreen("track")}
          />
        ) : screen === "menu" ? (
          <Menu
            data={menu}
            initialCategory={menuCategory}
            error={menuError}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadMenu(shopId);
              setRefreshing(false);
            }}
            onOpen={openProduct}
            onChangeShop={() => setScreen("shops")}
          />
        ) : screen === "product" && product ? (
          <Product
            product={product}
            variantId={variantId}
            quantity={quantity}
            onPick={setVariantId}
            onQuantity={setQuantity_}
            onBack={() => openMenu()}
          />
        ) : screen === "cart" ? (
          <Cart
            totals={totals}
            shop={shop}
            onChangeShop={() => setScreen("shops")}
            onBack={() => openMenu()}
            onQuantity={(index, next) => setCart((current) => setQuantity(current, index, next))}
            onRemove={(index) => setCart((current) => removeLine(current, index))}
            onBrowse={() => openMenu()}
          />
        ) : screen === "pickup" ? (
          <Pickup
            shop={shop}
            days={days}
            loading={slotsLoading}
            unavailableReason={slotsReason}
            today={storeToday}
            date={date}
            time={time}
            onPickDate={(next) => {
              setDate(next);
              setTime(null);
            }}
            onPickTime={setTime}
            onBack={() => setScreen("cart")}
            onChangeShop={() => setScreen("shops")}
          />
        ) : screen === "checkout" ? (
          <Checkout
            totals={totals}
            shop={shop}
            date={date}
            time={time}
            tip={tip}
            name={name}
            phone={phone}
            onTip={setTip}
            onName={setName}
            onPhone={setPhone}
            onBack={() => setScreen("pickup")}
            onPlaced={(placed) => {
              setOrder(placed);
              setConfirmMode("confirmation");
              setScreen("confirm");
            }}
            paymentBlocked={PAYMENT_BLOCKED}
          />
        ) : screen === "confirm" ? (
          <Confirm
            orderNumber={order?.orderNumber ?? null}
            accessKey={order?.accessKey ?? null}
            mode={confirmMode}
            onTrack={() => setScreen("track")}
            onHome={() => setScreen("home")}
          />
        ) : screen === "track" ? (
          <Track
            orderNumber={order?.orderNumber ?? null}
            accessKey={order?.accessKey ?? null}
            onBrowse={() => openMenu()}
            onShowPass={() => {
              setConfirmMode("pass");
              setScreen("confirm");
            }}
          />
        ) : (
          <Account
            token={accountToken}
            shop={shop}
            onSignIn={() => setScreen("signin")}
            onSignOut={async () => {
              await clearAccountToken();
              setAccountToken(null);
            }}
            onChangeShop={() => setScreen("shops")}
            onBrowse={() => openMenu()}
          />
        )}
        </ScreenTransition>
      </BlurTargetSurface>

      {toast ? <Toast message={toast} onView={() => setScreen("cart")} /> : null}

      {cta ? (
        <StickyCta label={cta.label} value={cta.value} onPress={cta.onPress} disabled={cta.disabled} />
      ) : null}

      {TABBED.includes(screen) ? (
        <TabBar
          current={screen}
          onSelect={(key) => {
            if (key === "menu") openMenu();
            else setScreen(key as Screen);
          }}
          cartCount={totals.itemCount}
          onCart={() => setScreen("cart")}
        />
      ) : null}
    </View>
  );
}

export default function App() {
  const [loaded] = useFonts({
    BebasNeue_400Regular,
    Poppins_300Light,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  /* Nothing renders until the faces are in. Bebas is the bakery's voice, and a
     flash of system sans in its place looks like a different shop. */
  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <BlurTargetProvider>
            <Shell />
          </BlurTargetProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
