import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ActivityKind, ActivityMonth } from "@/lib/activity";
import { formatSigned } from "@/lib/format";
import { signalColors } from "@/utils/theme";

/**
 * The month-grouped ledger.
 *
 * Not built on `ListRow`: an Activity row leads with a badge and its right
 * column is an amount over a realized gain, where a `ListRow`'s is a value
 * over a percentage. Sharing the component would mean two optional slots
 * and a branch for each — three similar lines beats a premature base
 * class (CLAUDE.md § Things to avoid).
 *
 * Every figure arrives pre-derived from `lib/activity.ts`; this file
 * decides only colour and layout.
 */
export function ActivityList({ months }: { months: ActivityMonth[] }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View testID="activity-list">
      {months.map((month) => (
        <View key={month.key} testID={`activity-month-${month.key}`}>
          <View style={styles.monthHeader}>
            <Text testID={`activity-month-label-${month.key}`} style={styles.monthLabel}>
              {month.label}
            </Text>
            <Text
              testID={`activity-month-net-${month.key}`}
              style={[
                styles.monthNet,
                { color: month.net >= 0 ? signalColors.up : signalColors.down },
              ]}
            >
              {`${formatSigned(month.net)} net`}
            </Text>
          </View>

          {month.rows.map((row) => (
            <View key={row.id} testID={`activity-row-${row.id}`} style={styles.row}>
              <View
                testID={`activity-badge-${row.id}`}
                style={[styles.badge, { backgroundColor: badgeBackground(row.kind) }]}
              >
                <Text style={[styles.badgeText, { color: badgeForeground(row.kind) }]}>
                  {row.badge}
                </Text>
              </View>

              <View style={styles.rowText}>
                <Text
                  testID={`activity-description-${row.id}`}
                  style={styles.description}
                  numberOfLines={1}
                >
                  {row.description}
                </Text>
                <Text
                  testID={`activity-subtitle-${row.id}`}
                  style={styles.subtitle}
                  numberOfLines={1}
                >
                  {row.subtitle}
                </Text>
              </View>

              <View style={styles.rowValues}>
                <Text testID={`activity-amount-${row.id}`} style={styles.amount}>
                  {row.amount}
                </Text>
                {row.realizedGain === null ? null : (
                  <Text
                    testID={`activity-realized-${row.id}`}
                    style={[
                      styles.realized,
                      {
                        color:
                          row.realizedGain >= 0 ? signalColors.up : signalColors.down,
                      },
                    ]}
                  >
                    {`${formatSigned(row.realizedGain)} realized`}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** The empty ledger, and the narrowed-to-nothing ledger — one component,
 * because the difference the user needs is *why*, and that is the chips
 * above it plus this copy. */
export function ActivityEmpty({ isFiltered }: { isFiltered: boolean }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View testID="activity-empty" style={styles.empty}>
      <Text style={styles.emptyTitle}>
        {isFiltered ? "No transactions in this slice" : "Nothing here yet"}
      </Text>
      <Text style={styles.emptyBody}>
        {isFiltered
          ? "Clear a filter above to widen the ledger."
          : "Every buy, sell, deposit and withdrawal you record shows up here."}
      </Text>
    </View>
  );
}

/**
 * Badge colours, tinted per kind so the four types are separable at a
 * glance without reading the label.
 *
 * Deliberately not `signalColors`: a buy is not "down" and a sell is not
 * "up" — they're categories. Realized gain, in the same row, *is*
 * directional and does use them, which is the distinction being kept.
 */
function badgeBackground(kind: ActivityKind): string {
  switch (kind) {
    case "buy":
      return "#152018";
    case "sell":
      return "#231519";
    case "deposit":
      return "#151A24";
    case "withdrawal":
      return "#1C1A15";
  }
}

function badgeForeground(kind: ActivityKind): string {
  switch (kind) {
    case "buy":
      return "#8FBFA1";
    case "sell":
      return "#D99AA2";
    case "deposit":
      return "#9DB4D9";
    case "withdrawal":
      return "#C7B48A";
  }
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    monthHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.sm,
    },
    monthLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    monthNet: { fontSize: theme.fontSize.xs, fontWeight: "600" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderLight,
    },
    badge: {
      minWidth: 44,
      alignItems: "center",
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.borderRadius.md,
    },
    badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
    rowText: { flex: 1, flexShrink: 1 },
    description: {
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
      fontWeight: "600",
    },
    subtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      marginTop: 2,
    },
    rowValues: { alignItems: "flex-end" },
    amount: {
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
      fontWeight: "500",
    },
    realized: { fontSize: theme.fontSize.xs, marginTop: 2 },
    empty: {
      marginHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.lg,
      paddingVertical: 34,
      paddingHorizontal: theme.spacing.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.lg,
      alignItems: "center",
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
      fontWeight: "700",
    },
    emptyBody: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.sm,
      marginTop: theme.spacing.sm,
      textAlign: "center",
    },
  });
}
