import { Platform } from "react-native";

/**
 * What the app is actually running on.
 *
 * The whole point of this spike is that "it worked on my machine" usually means
 * "it worked in a debug build on the old architecture". Every result has to be
 * read next to these facts or it proves nothing — so they are collected here and
 * printed at the top of the report.
 */

declare const global: {
  HermesInternal?: { getRuntimeProperties?: () => Record<string, string> };
  nativeFabricUIManager?: unknown;
  RN$Bridgeless?: boolean;
  __turboModuleProxy?: unknown;
};

export interface RuntimeFacts {
  platform: string;
  osVersion: string;
  reactNative: string;
  engine: string;
  fabric: boolean;
  bridgeless: boolean;
  turboModules: boolean;
  buildType: "debug" | "release";
}

export function runtimeFacts(): RuntimeFacts {
  const version = Platform.constants?.reactNativeVersion;
  const hermes = global.HermesInternal;
  const hermesVersion = hermes?.getRuntimeProperties?.()["OSS Release Version"];

  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    reactNative: version
      ? `${version.major}.${version.minor}.${version.patch}${version.prerelease ? `-${version.prerelease}` : ""}`
      : "unknown",
    engine: hermes ? `Hermes${hermesVersion ? ` ${hermesVersion}` : ""}` : "JSC or other",
    /* Fabric and bridgeless are separate switches. A build can be on the New
       Architecture's renderer while still going through the old bridge, and the
       legacy-interop bugs this spike is looking for live in that gap. */
    fabric: global.nativeFabricUIManager != null,
    bridgeless: global.RN$Bridgeless === true,
    turboModules: global.__turboModuleProxy != null || global.RN$Bridgeless === true,
    buildType: __DEV__ ? "debug" : "release",
  };
}

/**
 * The spike is only meaningful in a release build on the New Architecture.
 * Anything else is a warm-up, and the report says so rather than quietly
 * presenting a green screen.
 */
export function verdictCaveats(facts: RuntimeFacts): string[] {
  const caveats: string[] = [];
  if (facts.buildType === "debug") {
    caveats.push(
      "Debug build. Legacy interop most often diverges in release — rerun with `expo run:ios --configuration Release` / `expo run:android --variant release` before believing a pass.",
    );
  }
  if (!facts.fabric) caveats.push("Fabric is off — this is the old architecture, not what ships.");
  if (!facts.bridgeless) {
    caveats.push("Not bridgeless. New Arch is enabled but the old bridge is still in play.");
  }
  if (facts.engine.startsWith("JSC")) {
    caveats.push("Not running Hermes, so the Intl results below say nothing about the shipping engine.");
  }
  return caveats;
}
