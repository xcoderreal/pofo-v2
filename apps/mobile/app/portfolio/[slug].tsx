import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { GainsSummary } from "@/components/GainsSummary";
import { PositionTable } from "@/components/PositionTable";
import { useAccounts } from "@/hooks/useAccounts";
import { useGains } from "@/hooks/useGains";
import { useHistory } from "@/hooks/useHistory";
import { useInstruments } from "@/hooks/useInstruments";
import { usePositions } from "@/hooks/usePositions";

function parseSlug(slug: string): {
  type: "account" | "instrument";
  id: string;
} {
  if (slug.startsWith("account-")) {
    return { type: "account", id: slug.slice("account-".length) };
  }
  return { type: "instrument", id: slug.slice("instrument-".length) };
}

export default function PortfolioDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { type, id } = parseSlug(slug);

  const filterParams =
    type === "account"
      ? { account_id: id }
      : { instrument_id: id };

  const accounts = useAccounts();
  const instruments = useInstruments();
  const positions = usePositions(filterParams);
  const gains = useGains(filterParams);
  const history = useHistory(
    type === "account" ? { account_id: id } : undefined,
  );

  const instrumentNames = new Map(
    (instruments.data ?? []).map((i) => [i.id, `${i.name} (${i.ticker})`]),
  );
  const accountNames = new Map(
    (accounts.data ?? []).map((a) => [a.id, a.name]),
  );

  const title =
    type === "account"
      ? (accountNames.get(id) ?? id)
      : (instrumentNames.get(id) ?? id);

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
    <ScrollView style={styles.container} testID="portfolio-detail">
      <View style={styles.header}>
        <Text testID="detail-title" style={styles.title}>
          {title}
        </Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Value</Text>
            <Text style={styles.summaryValue}>${totalValue.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Cost</Text>
            <Text style={styles.summaryValue}>${totalCost.toFixed(2)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Unrealized</Text>
            <Text
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Positions</Text>
        <PositionTable
          positions={positions.data ?? []}
          instrumentNames={instrumentNames}
          accountNames={accountNames}
          showAccount={type === "instrument"}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Realized Gains</Text>
        <GainsSummary gains={gains.data ?? []} />
      </View>

      {(history.data ?? []).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Value History</Text>
          {(history.data ?? []).map((h) => (
            <View key={h.date} style={styles.historyRow}>
              <Text style={styles.historyDate}>{h.date}</Text>
              <Text style={styles.historyValue}>
                ${h.market_value.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
  summaryRow: { flexDirection: "row", gap: 12 },
  summaryCard: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  summaryLabel: { fontSize: 11, color: "#666", marginBottom: 2 },
  summaryValue: { fontSize: 15, fontWeight: "700" },
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#eee" },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 10 },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  historyDate: { fontSize: 13, color: "#666" },
  historyValue: { fontSize: 13, fontWeight: "600" },
});
