import { StyleSheet, Text, View } from "react-native";
import type { Position } from "@/lib/api";

interface Props {
  positions: Position[];
  instrumentNames?: Map<string, string>;
  accountNames?: Map<string, string>;
  showAccount?: boolean;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtGain(n: number | null | undefined): string {
  if (n == null) return "—";
  const prefix = n >= 0 ? "+" : "";
  return prefix + fmt(n);
}

export function PositionTable({
  positions,
  instrumentNames,
  accountNames,
  showAccount = false,
}: Props) {
  if (positions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text testID="no-positions" style={styles.emptyText}>
          No positions yet
        </Text>
      </View>
    );
  }

  return (
    <View testID="position-table">
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.nameCol]}>Instrument</Text>
        {showAccount && (
          <Text style={[styles.headerCell, styles.acctCol]}>Account</Text>
        )}
        <Text style={[styles.headerCell, styles.numCol]}>Shares</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Value</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Gain</Text>
      </View>
      {positions.map((p, i) => {
        const name = instrumentNames?.get(p.instrument_id) ?? p.instrument_id;
        const acctName =
          p.account_id != null
            ? (accountNames?.get(p.account_id) ?? p.account_id)
            : "All";
        const gainColor =
          p.unrealized_gain != null && p.unrealized_gain >= 0
            ? "#2e7d32"
            : "#c62828";
        return (
          <View
            key={`${p.instrument_id}-${p.account_id ?? "all"}-${i}`}
            style={styles.row}
            testID={`position-row-${p.instrument_id}`}
          >
            <Text style={[styles.cell, styles.nameCol]}>{name}</Text>
            {showAccount && (
              <Text style={[styles.cell, styles.acctCol]}>{acctName}</Text>
            )}
            <Text style={[styles.cell, styles.numCol]}>{fmt(p.quantity)}</Text>
            <Text style={[styles.cell, styles.numCol]}>
              ${fmt(p.market_value)}
            </Text>
            <Text style={[styles.cell, styles.numCol, { color: gainColor }]}>
              ${fmtGain(p.unrealized_gain)}
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
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 8,
    marginBottom: 4,
  },
  headerCell: { fontWeight: "700", fontSize: 12, color: "#666" },
  row: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  cell: { fontSize: 14 },
  nameCol: { flex: 2 },
  acctCol: { flex: 2 },
  numCol: { flex: 1.5, textAlign: "right" },
});
