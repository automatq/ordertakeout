import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  Pressable,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from "react-native";

import { Image as ExpoImage } from "expo-image";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import * as haptics from "../haptics";
import { useTheme } from "../theme";
import { Glass } from "./glass";
import { photoDefaults } from "./photo";
import { Body, Display, Label } from "./text";

export type Slide = {
  key: string;
  image: ImageSourcePropType;
  badge?: string;
  title: string;
  caption?: string;
  onPress?: () => void;
};

/** How far the photo lags the slide. Small on purpose — depth, not drift. */
const PARALLAX = 34;
const ADVANCE_MS = 5200;
/** Long enough that a browse is not interrupted by the carousel taking over. */
const RESUME_AFTER_MS = 9000;

/**
 * The hero carousel.
 *
 * Built on React Native's own `Animated` rather than Reanimated, which cannot be
 * installed here: Reanimated 4.6 wants worklets 0.12 and expo-modules-core caps
 * it at 0.10. Everything below runs on the native driver anyway, so the scroll
 * stays on the UI thread regardless.
 *
 * It stops moving on its own for anyone who has asked the system for less
 * motion or is running a screen reader. An auto-advancing carousel is one of the
 * few components that can actively take a screen away from someone mid-read.
 */
export function MotionSlider({ slides, height }: { slides: Slide[]; height: number }) {
  const { c } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(0);
  const resumeAt = useRef(0);
  const [width, setWidth] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    let active = true;
    const read = () =>
      Promise.all([
        AccessibilityInfo.isReduceMotionEnabled(),
        AccessibilityInfo.isScreenReaderEnabled(),
      ]).then(([motion, reader]) => {
        if (active) setStill(motion || reader);
      });
    void read();
    const subs = [
      AccessibilityInfo.addEventListener("reduceMotionChanged", () => void read()),
      AccessibilityInfo.addEventListener("screenReaderChanged", () => void read()),
    ];
    return () => {
      active = false;
      subs.forEach((s) => s.remove());
    };
  }, []);

  /* One timer that checks the clock, rather than one cancelled and rebuilt on
     every touch: the user's last interaction only has to move a timestamp. */
  useEffect(() => {
    if (still || width === 0 || slides.length < 2) return;
    const timer = setInterval(() => {
      if (Date.now() < resumeAt.current) return;
      const next = (indexRef.current + 1) % slides.length;
      indexRef.current = next;
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
    }, ADVANCE_MS);
    return () => clearInterval(timer);
  }, [still, width, slides.length]);

  /* Guarded, and it is not paranoia: Android reports sub-pixel widths that can
     alternate between two neighbouring values, so setting state unconditionally
     here is a re-layout loop that pins a core at 100% and ends in an ANR. iOS
     happens to settle, which is why this only ever bites on one platform. */
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
  };

  const settle = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width > 0) indexRef.current = Math.round(event.nativeEvent.contentOffset.x / width);
    },
    [width],
  );

  const hold = useCallback(() => {
    resumeAt.current = Date.now() + RESUME_AFTER_MS;
  }, []);

  return (
    <View onLayout={onLayout}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
        })}
        onScrollBeginDrag={hold}
        onScrollEndDrag={hold}
        onMomentumScrollEnd={settle}
        style={{ height }}
      >
        {slides.map((slide, i) => (
          <SlideView
            key={slide.key}
            slide={slide}
            index={i}
            width={width}
            height={height}
            scrollX={scrollX}
            still={still}
          />
        ))}
      </Animated.ScrollView>

      {slides.length > 1 ? (
        <View
          /* Top right, not bottom centre: the pickup-rule chip overlaps the
             bottom of this frame by design, and dots underneath it are dots
             nobody can see. In a glass pill because white dots vanish over the
             pale top edge of a tray photo. */
          style={{ position: "absolute", top: 12, right: 14 }}
          pointerEvents="none"
        >
          <Glass
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              paddingHorizontal: 10,
              paddingVertical: 7,
              borderRadius: 999,
              overflow: "hidden",
            }}
            solid={{ backgroundColor: "rgba(26,26,26,0.34)" }}
            glassStyle="clear"
          >
            {slides.map((slide, i) => (
              <Dot key={slide.key} index={i} width={width} scrollX={scrollX} tint={c.brandInk} />
            ))}
          </Glass>
        </View>
      ) : null}
    </View>
  );
}

function SlideView({
  slide,
  index,
  width,
  height,
  scrollX,
  still,
}: {
  slide: Slide;
  index: number;
  width: number;
  height: number;
  scrollX: Animated.Value;
  still: boolean;
}) {
  const { c } = useTheme();
  /* Unique per slide. react-native-svg resolves `url(#id)` against a registry
     shared across every Svg in the tree, so five slides all defining
     "slideScrim" is five brushes fighting over one name. */
  const scrimId = `slideScrim-${index}`;
  const span = width || 1;
  const range = [(index - 1) * span, index * span, (index + 1) * span];

  /* Guarded rather than merely reduced: an interpolation over a zero width
     collapses its input range and throws. */
  const drift = still || width === 0 ? 0 : PARALLAX;
  const shift = scrollX.interpolate({
    inputRange: range,
    outputRange: [drift, 0, -drift],
    extrapolate: "clamp",
  });
  const fade = scrollX.interpolate({
    inputRange: range,
    outputRange: [0, 1, 0],
    extrapolate: "clamp",
  });

  return (
    <Pressable
      onPress={slide.onPress}
      onPressIn={slide.onPress && haptics.tap}
      accessibilityRole={slide.onPress ? "button" : "image"}
      accessibilityLabel={[slide.badge, slide.title, slide.caption].filter(Boolean).join(", ")}
      style={{ width, height, overflow: "hidden" }}
    >
      {/* The transform lives on a plain Animated.View wrapping the image, not
          on the image itself. Driving an Animated-wrapped expo-image blows the
          Android render thread's stack — a native SIGSEGV inside
          RenderNode::prepareTreeImpl. Wrapping keeps the disk cache and the
          fade and moves the animation onto a view Android is happy to
          transform. */}
      <Animated.View
        style={{
          width: width + PARALLAX * 2,
          height,
          marginLeft: -PARALLAX,
          transform: [{ translateX: shift }],
        }}
      >
        <ExpoImage
          source={slide.image}
          style={{ width: "100%", height, backgroundColor: c.surfaceSunken }}
          {...photoDefaults}
        />
      </Animated.View>
      {/* A gradient, not a tinted block: a flat scrim puts a hard horizontal
          edge across the middle of the photo, which is visible on every slide
          and looks like a rendering fault. */}
      <Svg
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
        width={width}
        height={height * 0.7}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id={scrimId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1a1a1a" stopOpacity="0" />
            <Stop offset="0.55" stopColor="#1a1a1a" stopOpacity="0.34" />
            <Stop offset="1" stopColor="#1a1a1a" stopOpacity="0.58" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height * 0.7} fill={`url(#${scrimId})`} />
      </Svg>

      <Animated.View
        style={{ position: "absolute", left: 14, right: 14, bottom: 34, opacity: fade }}
        pointerEvents="none"
      >
        {slide.badge ? (
          /* The design's own product badge rather than glass: clear glass over
             a bright tray photo reads as unstyled text, and this is the same
             chip the menu and the home rail already use for the same fact. */
          <View
            style={{
              alignSelf: "flex-start",
              marginBottom: 8,
              paddingHorizontal: 11,
              paddingVertical: 5,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: `${c.accentInk}38`,
              backgroundColor: c.accentSoft,
            }}
          >
            <Label size={10.5} color={c.accentInk}>
              {slide.badge}
            </Label>
          </View>
        ) : null}
        <Display size={30} color={c.brandInk} numberOfLines={2}>
          {slide.title}
        </Display>
        {slide.caption ? (
          <Body size={12.5} color="rgba(255,255,255,0.9)" numberOfLines={1}>
            {slide.caption}
          </Body>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

function Dot({
  index,
  width,
  scrollX,
  tint,
}: {
  index: number;
  width: number;
  scrollX: Animated.Value;
  tint: string;
}) {
  const span = width || 1;
  const range = [(index - 1) * span, index * span, (index + 1) * span];
  /* scaleX rather than width: layout properties cannot run on the native
     driver, and a dot that animates on the JS thread stutters exactly when the
     list it belongs to is being flung. */
  const stretch = scrollX.interpolate({
    inputRange: range,
    outputRange: [1, 2.6, 1],
    extrapolate: "clamp",
  });
  const opacity = scrollX.interpolate({
    inputRange: range,
    outputRange: [0.45, 1, 0.45],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: tint,
        opacity,
        transform: [{ scaleX: stretch }],
      }}
    />
  );
}
