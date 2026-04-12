import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GainsSummary } from "@/components/GainsSummary";
import { PositionTable } from "@/components/PositionTable";
import { useAccounts } from "@/hooks/useAccounts";
import { useGains } from "@/hooks/useGains";
import { useInstruments } from "@/hooks/useInstruments";
import { usePositions } from "@/hooks/usePositions";

export default function DashboardScreen() {
  const router = useRouter();
  const accounts = useAccounts();
  const instruments = useInstruments();
  const positions = usePositions();
  const gains = useGains();

  const instrumentNames = new Map(
    (instruments.data ?? []).map((i) => [i.id, `${i.name} (${i.ticker})`]),
  );

  if (positions.isLoading) {
    return (
      <View style={styles.center}>
        <Text testID="loading">Loading...</Text>
      </View>
    );
  }

  const totalValue = (positions.data ?? []).reduce(
    (sum, p) => sum + (p.market_value ?? 0),
    0,
  );
  const totalCost = (positions.data ?? []).reduce(
    (sum, p) => sum + p.cost_basis,
    0,
  );
  const totalGain = totalValue - totalCost;

  return (
    <ScrollView style={styles.container} testID="dashboard">
      {/* ─── Nav toolbar ─────────────────────── */}
      <View style={styles.toolbar}>
        <Pressable
          testID="nav-accounts"
          onPress={() => router.push("/accounts")}
          style={styles.navButton}
        >
          <Text style={styles.navButtonText}>Accounts</Text>
        </Pressable>
        <Pressable
          testID="nav-instruments"
          onPress={() => router.push("/instruments")}
          style={styles.navButton}
        >
          <Text style={styles.navButtonText}>Instruments</Text>
        </Pressable>
        <Pressable
          testID="nav-new-trade"
          onPress={() => router.push("/transactions/new")}
          style={[styles.navButton, styles.primaryButton]}
        >
          <Text style={[styles.navButtonText, styles.primaryButtonText]}>
            + Trade
          </Text>
        </Pressable>
      </View>

      {/* ─── Portfolio summary ───────────────── */}
      <View style={styles.section}>
        <Text testID="portfolio-header" style={styles.sectionTitle}>
          Portfolio Overview
        </Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Value</Text>
            <Text testID="total-value" style={styles.summaryValue}>
              ${totalValue.toFixed(2)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Cost</Text>
            <Text style={styles.summaryValue}>${totalCost.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Unrealized</Text>
            <Text
              testID="total-unrealized"
              style={[
                styles.summaryValue,
                { color: totalGain >= 0 ? "#2e7d32" : "#c62828" },
              ]}
            >
              {totalGain >= 0 ? "+" : ""}
              {totalGain.toFixed(2)}
            </Text>
          </View>
        </View>
      </View>

      {/* ─── Positions by instrument ─────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Positions by Instrument</Text>
        <PositionTable
          positions={positions.data ?? []}
          instrumentNames={instrumentNames}
        />
      </View>

      {/* ─── Drill-down: By account ──────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>By Account</Text>
        {(accounts.data ?? []).length === 0 ? (
          <Text style={styles.hint}>No accounts yet — add one to start</Text>
        ) : (
          (accounts.data ?? []).map((acct) => (
            <Pressable
              key={acct.id}
              testID={`account-card-${acct.id}`}
              onPress={() =>
                router.push(`/portfolio/account-${acct.id}`)
              }
              style={styles.drillCard}
            >
              <Text style={styles.drillName}>{acct.name}</Text>
              <Text style={styles.drillType}>{acct.account_type}</Text>
            </Pressable>
          ))
        )}
      </View>

      {/* ─── Drill-down: By instrument ────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>By Instrument</Text>
        {(instruments.data ?? []).length === 0 ? (
          <Text style={styles.hint}>
            No instruments yet — add one to start
          </Text>
        ) : (
          (instruments.data ?? []).map((inst) => (
            <Pressable
              key={inst.id}
              testID={`instrument-card-${inst.id}`}
              onPress={() =>
                router.push(`/portfolio/instrument-${inst.id}`)
              }
              style={styles.drillCard}
            >
              <Text style={styles.drillName}>
                {inst.ticker} — {inst.name}
              </Text>
            </Pressable>
          ))
        )}
      </View>

      {/* ─── Realized gains ────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Realized Gains</Text>
        <GainsSummary gains={gains.data ?? []} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  toolbar: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  navButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  navButtonText: { fontWeight: "600", fontSize: 13 },
  primaryButton: { backgroundColor: "#4a90d9", borderColor: "#4a90d9" },
  primaryButtonText: { color: "#fff" },
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee" },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  summaryRow: { flexDirection: "row", gap: 12 },
  summaryCard: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  summaryLabel: { fontSize: 11, color: "#666", marginBottom: 4 },
  summaryValue: { fontSize: 16, fontWeight: "700" },
  drillCard: {
    backgroundColor: "#f9f9f9",
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
  },
  drillName: { fontSize: 15, fontWeight: "600" },
  drillType: { fontSize: 12, color: "#666", marginTop: 2 },
  hint: { color: "#999", fontSize: 13 },
});
