import { StyleSheet, Text, View } from "react-native";
import type { RealizedGain } from "@/lib/api";

interface Props {
  gains: RealizedGain[];
}

function fmt(n: number): string {
  const prefix = n >= 0 ? "+" : "";
  return (
    prefix +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function GainsSummary({ gains }: Props) {
  if (gains.length === 0) {
    return (
      <View style={styles.empty}>
        <Text testID="no-gains" style={styles.emptyText}>
          No realized gains yet
        </Text>
      </View>
    );
  }

  const total = gains.reduce((sum, g) => sum + g.gain, 0);
  const color = total >= 0 ? "#2e7d32" : "#c62828";

  return (
    <View testID="gains-summary">
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total Realized Gain/Loss</Text>
        <Text testID="total-realized-gain" style={[styles.totalValue, { color }]}>
          ${fmt(total)}
        </Text>
      </View>
      <View style={styles.detailHeader}>
        <Text style={[styles.headerCell, styles.qtyCol]}>Qty</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Buy</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Sell</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Gain</Text>
      </View>
      {gains.map((g, i) => {
        const gColor = g.gain >= 0 ? "#2e7d32" : "#c62828";
        return (
          <View key={`${g.sell_transaction_id}-${g.buy_transaction_id}-${i}`} style={styles.row}>
            <Text style={[styles.cell, styles.qtyCol]}>
              {g.quantity.toFixed(1)}
            </Text>
            <Text style={[styles.cell, styles.numCol]}>
              ${g.buy_price.toFixed(2)}
            </Text>
            <Text style={[styles.cell, styles.numCol]}>
              ${g.sell_price.toFixed(2)}
            </Text>
            <Text style={[styles.cell, styles.numCol, { color: gColor }]}>
              ${fmt(g.gain)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 24, alignItems: "center" },
  emptyText: { color: "#999", fontSize: 14 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    marginBottom: 8,
  },
  totalLabel: { fontSize: 14, fontWeight: "600" },
  totalValue: { fontSize: 18, fontWeight: "700" },
  detailHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 6,
    marginBottom: 4,
  },
  headerCell: { fontWeight: "700", fontSize: 12, color: "#666" },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  cell: { fontSize: 13 },
  qtyCol: { flex: 1 },
  numCol: { flex: 1.5, textAlign: "right" },
});
