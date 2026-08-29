import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme";
import { Button } from "./controls";
import { Body, Display } from "./text";

/**
 * The screen shown when a render throws.
 *
 * A function component so it can read the theme; the boundary itself has to be
 * a class, because catching a render error is the one thing hooks still cannot
 * do.
 */
function Fallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.canvas,
        paddingTop: insets.top + 24,
        paddingBottom: Math.max(insets.bottom, 24),
        paddingHorizontal: 24,
        justifyContent: "center",
        gap: 14,
      }}
    >
      <Display size={34}>That didn&apos;t go to plan</Display>
      <Body size={14.5} color={c.inkMuted}>
        Something broke on our side, not yours. Your basket and any order you have already
        placed are still safe — try again, and if it keeps happening, close the app and
        reopen it.
      </Body>

      {/* The message is worth showing while developing and worth hiding after:
          a stack trace tells a customer nothing and looks like the app is
          coming apart. */}
      {__DEV__ ? (
        <ScrollView
          style={{
            maxHeight: 160,
            borderRadius: 12,
            backgroundColor: c.surfaceSunken,
            padding: 12,
          }}
        >
          <Body size={12} color={c.inkSubtle}>
            {error?.stack ?? error?.message ?? String(error)}
          </Body>
        </ScrollView>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <Button label="Try again" onPress={onRetry} />
      </View>
    </View>
  );
}

/**
 * Stops one thrown render from taking the whole app with it.
 *
 * Without this a single bad value anywhere in the tree unmounts everything and
 * leaves a blank screen with no way out but force-quitting — which, on a phone,
 * most people read as the app being broken rather than one screen being broken.
 *
 * Retry clears the error and re-renders. If whatever threw is still there it
 * will throw again, which is the honest outcome: this recovers from the
 * transient case and does not pretend to fix the rest.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* Logged rather than reported: there is no crash reporter wired up yet, so
       this is all the trail there is. */
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <Fallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
