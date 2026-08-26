import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { runIntlChecks, type CheckResult } from "./src/intl-check";
import { runtimeFacts, verdictCaveats } from "./src/runtime";
import { collectNonce, configure, cycleOpenCancel, rejectNonceInSheet } from "./src/square-checks";

const APPLICATION_ID = process.env.EXPO_PUBLIC_SQUARE_APPLICATION_ID ?? "";
const CYCLES = 20;

type Status = "idle" | "running" | "pass" | "fail";
interface SquareResult {
  status: Status;
  detail: string;
}

const IDLE: SquareResult = { status: "idle", detail: "" };

export default function App() {
  const facts = useMemo(() => runtimeFacts(), []);
  const caveats = useMemo(() => verdictCaveats(facts), [facts]);
  // Pure and synchronous, so there is nothing to await and nothing to get wrong
  // about when it ran.
  const intl = useMemo(() => runIntlChecks(), []);

  const [nonce, setNonce] = useState<SquareResult>(IDLE);
  const [inSheetError, setInSheetError] = useState<SquareResult>(IDLE);
  const [cycles, setCycles] = useState<SquareResult>(IDLE);

  const configured = APPLICATION_ID.length > 0;
  useEffect(() => {
    if (configured) configure(APPLICATION_ID);
  }, [configured]);

  async function runNonce() {
    setNonce({ status: "running", detail: "Sheet open — enter 4111 1111 1111 1111" });
    try {
      const result = await collectNonce();
      if (result === "cancelled") return setNonce({ status: "idle", detail: "Cancelled." });
      setNonce({
        status: result.looksLikeCardNonce ? "pass" : "fail",
        detail: result.looksLikeCardNonce
          ? `${result.brand} ••${result.lastFour} → ${result.nonce.slice(0, 14)}…`
          : `Token is not a cnon: — got "${result.nonce.slice(0, 24)}…"`,
      });
    } catch (cause) {
      setNonce({ status: "fail", detail: describe(cause) });
    }
  }

  async function runInSheetError() {
    setInSheetError({ status: "running", detail: "Submit a card, then look at the sheet." });
    try {
      const result = await rejectNonceInSheet("Declined — this is the spike talking");
      setInSheetError(
        result === "stayed-open"
          ? { status: "pass", detail: "Error was returned; sheet handled it and then closed." }
          : { status: "idle", detail: "Cancelled without submitting — nothing proven." },
      );
    } catch (cause) {
      setInSheetError({ status: "fail", detail: describe(cause) });
    }
  }

  async function runCycles() {
    setCycles({ status: "running", detail: `0/${CYCLES} — tap Cancel each time` });
    try {
      const done = await cycleOpenCancel(CYCLES, (n) =>
        setCycles({ status: "running", detail: `${n}/${CYCLES} — tap Cancel each time` }),
      );
      setCycles(
        done === CYCLES
          ? { status: "pass", detail: `${CYCLES} open/cancel cycles, no crash.` }
          : { status: "idle", detail: `Stopped at ${done} — a card was submitted.` },
      );
    } catch (cause) {
      setCycles({ status: "fail", detail: describe(cause) });
    }
  }

  const intlPassed = intl.filter((c) => c.pass).length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="dark" />

      <Text style={styles.title}>Gate 0 spike</Text>
      <Text style={styles.subtitle}>
        Square In-App Payments and Hermes date handling, on the New Architecture.
      </Text>

      <View style={styles.factBox}>
        {(
          [
            ["Platform", `${facts.platform} ${facts.osVersion}`],
            ["React Native", facts.reactNative],
            ["Engine", facts.engine],
            ["Build", facts.buildType],
            ["Fabric", yesNo(facts.fabric)],
            ["Bridgeless", yesNo(facts.bridgeless)],
            ["TurboModules", yesNo(facts.turboModules)],
          ] as const
        ).map(([label, value]) => (
          <View key={label} style={styles.factRow}>
            <Text style={styles.factLabel}>{label}</Text>
            <Text style={styles.factValue}>{value}</Text>
          </View>
        ))}
      </View>

      {caveats.map((caveat) => (
        <Text key={caveat} style={styles.caveat}>
          {caveat}
        </Text>
      ))}

      <Section
        title="Hermes date handling"
        note={`${intlPassed}/${intl.length} passing. These are the exact calculations lib/scheduling/time.ts makes.`}
      >
        {intl.map((result) => (
          <IntlRow key={result.name} result={result} />
        ))}
      </Section>

      <Section
        title="Square card entry"
        note={
          configured
            ? "Sandbox card 4111 1111 1111 1111, any future expiry, any CVV, postal 10003."
            : "Set EXPO_PUBLIC_SQUARE_APPLICATION_ID before running these."
        }
      >
        <Check
          label={`1. Sheet presents and returns a cnon: token`}
          result={nonce}
          onPress={runNonce}
          disabled={!configured}
        />
        <Check
          label="2. A rejected charge renders inside the sheet"
          result={inSheetError}
          onPress={runInSheetError}
          disabled={!configured}
        />
        <Check
          label={`3. ${CYCLES} open/cancel cycles without a leak`}
          result={cycles}
          onPress={runCycles}
          disabled={!configured}
        />
      </Section>

      <Section title="Report" note="Long-press to select and copy.">
        <Text selectable style={styles.report}>
          {report(facts, caveats, intl, { nonce, inSheetError, cycles })}
        </Text>
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionNote}>{note}</Text>
      {children}
    </View>
  );
}

function IntlRow({ result }: { result: CheckResult }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.pill, result.pass ? styles.pillPass : styles.pillFail]}>
        {result.pass ? "PASS" : "FAIL"}
      </Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{result.name}</Text>
        {result.pass ? null : (
          <Text style={styles.rowDetail}>
            expected {result.expected}, got {result.actual}
          </Text>
        )}
        {!result.pass && result.consequence ? (
          <Text style={styles.rowConsequence}>{result.consequence}</Text>
        ) : null}
      </View>
    </View>
  );
}

function Check({
  label,
  result,
  onPress,
  disabled,
}: {
  label: string;
  result: SquareResult;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.check}>
      <Text style={styles.rowTitle}>{label}</Text>
      {result.detail ? <Text style={styles.rowDetail}>{result.detail}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={disabled || result.status === "running"}
        style={({ pressed }) => [
          styles.button,
          (disabled || result.status === "running") && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>
          {result.status === "running" ? "Running…" : result.status === "idle" ? "Run" : "Run again"}
        </Text>
      </Pressable>
    </View>
  );
}

const yesNo = (value: boolean) => (value ? "yes" : "no");
const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function report(
  facts: ReturnType<typeof runtimeFacts>,
  caveats: string[],
  intl: CheckResult[],
  square: Record<string, SquareResult>,
): string {
  return [
    `platform      ${facts.platform} ${facts.osVersion}`,
    `react-native  ${facts.reactNative}`,
    `engine        ${facts.engine}`,
    `build         ${facts.buildType}`,
    `fabric        ${yesNo(facts.fabric)}`,
    `bridgeless    ${yesNo(facts.bridgeless)}`,
    "",
    ...caveats.map((c) => `CAVEAT ${c}`),
    "",
    `intl          ${intl.filter((c) => c.pass).length}/${intl.length}`,
    ...intl.filter((c) => !c.pass).map((c) => `  FAIL ${c.name}: expected ${c.expected}, got ${c.actual}`),
    "",
    ...Object.entries(square).map(([key, value]) => `${key.padEnd(13)} ${value.status} ${value.detail}`),
  ].join("\n");
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f5f1e9" },
  content: { padding: 20, paddingTop: 64, paddingBottom: 64, gap: 16 },
  title: { fontSize: 28, fontWeight: "700", color: "#1c1917" },
  subtitle: { fontSize: 15, color: "#57534e", marginTop: -10 },
  factBox: { backgroundColor: "#fff", borderRadius: 16, padding: 14, gap: 4 },
  factRow: { flexDirection: "row", justifyContent: "space-between" },
  factLabel: { fontSize: 13, color: "#78716c" },
  factValue: { fontSize: 13, color: "#1c1917", fontWeight: "600" },
  caveat: {
    backgroundColor: "#fef3c7",
    color: "#78350f",
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  section: { gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#1c1917" },
  sectionNote: { fontSize: 13, color: "#78716c", marginBottom: 4 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 14, color: "#1c1917" },
  rowDetail: { fontSize: 12, color: "#78716c", marginTop: 2 },
  rowConsequence: { fontSize: 12, color: "#9f1239", marginTop: 2, lineHeight: 17 },
  pill: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
    marginTop: 1,
  },
  pillPass: { backgroundColor: "#dcfce7", color: "#166534" },
  pillFail: { backgroundColor: "#fee2e2", color: "#991b1b" },
  check: { backgroundColor: "#fff", borderRadius: 16, padding: 14, gap: 6 },
  button: {
    backgroundColor: "#9E3136",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  report: {
    fontFamily: "Courier",
    fontSize: 11,
    color: "#1c1917",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    lineHeight: 16,
  },
});
