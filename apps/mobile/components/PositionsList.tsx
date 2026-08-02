import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { formatPercent, formatShares, formatSigned, formatUsd } from "@/lib/format";
import type { AccountRow, HoldingRow } from "@/lib/positions";
import { signalColors } from "@/utils/theme";

export type ListTab = "holdings" | "accounts";

interface Props {
  tab: ListTab;
  onSelectTab: (tab: ListTab) => void;
  holdings: HoldingRow[];
  /** Fully closed positions — zero shares, realized gain booked. Kept out
   * of the live list and shown under a collapsed disclosure instead. */
  closedHoldings: HoldingRow[];
  accounts: AccountRow[];
  isPending: boolean;
  errorMessage?: string | null;
}

/**
 * What you actually hold, below the chart: one row per Instrument
 * (Holdings) or per Account (Accounts).
 *
 * Purely presentational — every figure is computed by `lib/positions.ts`
 * and handed in, so the interesting logic is unit-testable without a
 * renderer. The closed-positions disclosure's open/closed flag is the one
 * piece of state that lives here, because nothing outside this component
 * reads it.
 */
export function PositionsList({
  tab,
  onSelectTab,
  holdings,
  closedHoldings,
  accounts,
  isPending,
  errorMessage,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [showClosed, setShowClosed] = useState(false);

  return (
    <View testID="positions-list" style={styles.container}>
      <View style={styles.tabs}>
        <Tab
          testID="tab-holdings"
          label="Holdings"
          count={holdings.length}
          active={tab === "holdings"}
          onPress={() => onSelectTab("holdings")}
          styles={styles}
        />
        <Tab
          testID="tab-accounts"
          label="Accounts"
          count={accounts.length}
          active={tab === "accounts"}
          onPress={() => onSelectTab("accounts")}
          styles={styles}
        />
      </View>

      {errorMessage ? (
        <Text testID="positions-error" style={styles.error}>
          {errorMessage}
        </Text>
      ) : isPending ? (
        <View testID="positions-loading" style={styles.pending}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : tab === "holdings" ? (
        <>
          {holdings.length === 0 && closedHoldings.length === 0 ? (
            <Text testID="positions-empty" style={styles.empty}>
              Nothing here yet. Add your first buy and it starts charting from
              that date.
            </Text>
          ) : null}

          {holdings.map((row) => (
            <Row
              key={row.instrumentId}
              testID={`holding-row-${row.instrumentId}`}
              title={row.symbol}
              subtitle={`${row.name} · ${formatShares(row.shareCount)}`}
              value={row.marketValue === null ? "—" : formatUsd(row.marketValue)}
              valueTestID={`holding-value-${row.instrumentId}`}
              detail={formatPercent(row.changePercent)}
              detailTestID={`holding-percent-${row.instrumentId}`}
              detailColor={changeColor(row.changePercent, theme)}
              styles={styles}
            />
          ))}

          {closedHoldings.length > 0 ? (
            <>
              <Pressable
                testID="closed-toggle"
                accessibilityState={{ expanded: showClosed }}
                onPress={() => setShowClosed((open) => !open)}
                style={styles.disclosure}
              >
                <Text style={styles.disclosureLabel}>
                  Closed positions · {closedHoldings.length}
                </Text>
                <Text style={styles.disclosureAction}>
                  {showClosed ? "Hide" : "Show"}
                </Text>
              </Pressable>

              {showClosed
                ? closedHoldings.map((row) => (
                    <Row
                      key={row.instrumentId}
                      testID={`closed-row-${row.instrumentId}`}
                      title={row.symbol}
                      subtitle={`${row.name} · closed`}
                      value="—"
                      valueTestID={`closed-value-${row.instrumentId}`}
                      detail={`realized ${formatSigned(row.realizedGain)}`}
                      detailTestID={`closed-realized-${row.instrumentId}`}
                      detailColor={changeColor(row.realizedGain, theme)}
                      styles={styles}
                    />
                  ))
                : null}
            </>
          ) : null}
        </>
      ) : (
        <>
          {accounts.length === 0 ? (
            <Text testID="positions-empty" style={styles.empty}>
              No accounts yet.
            </Text>
          ) : null}

          {accounts.map((row) => (
            <Row
              key={row.accountId}
              testID={`account-row-${row.accountId}`}
              title={row.name}
              subtitle={row.accountType}
              value={row.value === null ? "—" : formatUsd(row.value)}
              valueTestID={`account-value-${row.accountId}`}
              detail={formatPercent(row.changePercent)}
              detailTestID={`account-percent-${row.accountId}`}
              detailColor={changeColor(row.changePercent, theme)}
              styles={styles}
            />
          ))}
        </>
      )}
    </View>
  );
}

function changeColor(
  value: number | null,
  theme: ReturnType<typeof useTheme>,
): string {
  if (value === null) return theme.colors.textTertiary;
  return value >= 0 ? signalColors.up : signalColors.down;
}

type Styles = ReturnType<typeof makeStyles>;

function Tab({
  testID,
  label,
  count,
  active,
  onPress,
  styles,
}: {
  testID: string;
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label} · {count}
      </Text>
    </Pressable>
  );
}

function Row({
  testID,
  title,
  subtitle,
  value,
  valueTestID,
  detail,
  detailTestID,
  detailColor,
  styles,
}: {
  testID: string;
  title: string;
  subtitle: string;
  value: string;
  valueTestID: string;
  detail: string;
  detailTestID: string;
  detailColor: string;
  styles: Styles;
}) {
  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.rowValues}>
        <Text testID={valueTestID} style={styles.rowValue}>
          {value}
        </Text>
        <Text testID={detailTestID} style={[styles.rowDetail, { color: detailColor }]}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: { marginTop: theme.spacing.xl },
    tabs: {
      flexDirection: "row",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    tab: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
    },
    tabActive: { backgroundColor: theme.colors.surface },
    tabText: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.md,
      fontWeight: "500",
    },
    tabTextActive: { color: theme.colors.text },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderLight,
    },
    rowText: { flexShrink: 1 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      fontWeight: "600",
    },
    rowSubtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.sm,
      marginTop: 2,
    },
    rowValues: { alignItems: "flex-end" },
    rowValue: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      fontWeight: "500",
    },
    rowDetail: { fontSize: theme.fontSize.sm, marginTop: 2 },
    disclosure: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    disclosureLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
    },
    disclosureAction: {
      color: theme.colors.primary,
      fontSize: theme.fontSize.md,
      fontWeight: "500",
    },
    pending: { paddingVertical: theme.spacing.xl, alignItems: "center" },
    error: {
      color: theme.colors.danger,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
    },
    empty: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
    },
  });
}
