import { defineConfig } from "vitest/config";

/**
 * Only the pure modules.
 *
 * Most of this app is React Native components, which need a native runtime to
 * mean anything and are verified by building and driving the app. What is worth
 * testing here is the logic that has no UI and is otherwise only ever exercised
 * by hand — deep link parsing above all, because getting it wrong sends somebody
 * who tapped a link in their confirmation email to the wrong screen, and nobody
 * would notice until a customer said so.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
