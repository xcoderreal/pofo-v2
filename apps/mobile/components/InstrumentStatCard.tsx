import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { formatShares, formatSigned, formatUsd } from "@/lib/format";
import type { InstrumentStats } from "@/lib/positions";
import { signalColors } from "@/utils/theme";

interface Props {
  stats: InstrumentStats;
}

/**
 * The six figures an instrument level answers that the chart alone cannot
 * — shares, market price, average cost, unrealized gain, all-time
 * realized gain and cost basis.
 *
 * All six come from the batched positions call the list already makes
 * (docs/adr/0001-dashboard-v2.md § 5), so the card costs no extra round
 * trip. Realized gain is deliberately *all time* rather than range-scoped
 * — it is the one figure on this screen that is a lifetime fact about the
 * position, and scoping it to the range would make a booked gain vanish
 * when you narrow the window.
 */
export function InstrumentStatCard({ stats }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const fields: { key: string; testID: string; label: string; value: string; color?: string }[] = [
    {
      key: "shares",
      testID: "stat-shares",
      label: "Shares",
      value: formatShares(stats.shareCount),
    },
    {
      key: "price",
      testID: "stat-market-price",
      label: "Market price",
      value: stats.marketPrice === null ? "—" : formatUsd(stats.marketPrice),
    },
    {
      key: "avg",
      testID: "stat-avg-cost",
      label: "Avg cost",
      value: stats.averageCost === null ? "—" : formatUsd(stats.averageCost),
    },
    {
      key: "unrealized",
      testID: "stat-unrealized",
      label: "Unrealized",
      value:
        stats.unrealizedGain === null ? "—" : formatSigned(stats.unrealizedGain),
      color:
        stats.unrealizedGain === null
          ? undefined
          : stats.unrealizedGain >= 0
            ? signalColors.up
            : signalColors.down,
    },
    {
      key: "realized",
      testID: "stat-realized",
      label: "Realized (all time)",
      value: formatSigned(stats.realizedGain),
      color: stats.realizedGain >= 0 ? signalColors.up : signalColors.down,
    },
    {
      key: "cost-basis",
      testID: "stat-cost-basis",
      label: "Cost basis",
      value: formatUsd(stats.costBasis),
    },
  ];

  return (
    <View testID="instrument-stat-card" style={styles.card}>
      {fields.map((field) => (
        <View key={field.key} style={styles.cell}>
          <Text style={styles.label}>{field.label}</Text>
          <Text
            testID={field.testID}
            style={[styles.value, field.color ? { color: field.color } : null]}
          >
            {field.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      flexWrap: "wrap",
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      marginHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
    },
    cell: {
      width: "33.33%",
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    label: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
    },
    value: {
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
      fontWeight: "500",
      marginTop: 2,
    },
  });
}
