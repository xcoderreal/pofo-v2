import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { changeColor, ListRow, SectionTitle } from "@/components/ListRow";
import { useTheme } from "@/hooks/useTheme";
import { formatPercent, formatShares, formatSigned, formatUsd } from "@/lib/format";
import type { ListTab } from "@/lib/drilldown";
import type { AccountRow, HoldingRow } from "@/lib/positions";

export type { ListTab };

interface Props {
  /** Tabs belong to the portfolio level only — every narrower level has
   * exactly one list, headed by a section title instead. */
  showTabs: boolean;
  tab: ListTab;
  onSelectTab: (tab: ListTab) => void;
  holdings: HoldingRow[];
  /** Fully closed positions — zero shares, realized gain booked. Kept out
   * of the live list and shown under a collapsed disclosure instead. */
  closedHoldings: HoldingRow[];
  accounts: AccountRow[];
  /** Uninvested cash in the selected account, at account level. Shown as
   * the first row, ahead of the holdings
   * (docs/design/dashboard_v2/behaviour.md § Navigation and scope). */
  cash?: { value: number; subtitle: string } | null;
  onSelectInstrument: (instrumentId: string) => void;
  onSelectAccount: (accountId: string) => void;
  onSelectCash?: () => void;
  isPending: boolean;
  errorMessage?: string | null;
}

/**
 * What you hold, below the chart: one row per Instrument (Holdings) or
 * per Account (Accounts).
 *
 * The same component serves the portfolio and account levels — an account
 * is the portfolio's Holdings list asking a narrower question, plus its
 * cash row — which is why drilling down is a scope change rather than a
 * route (behaviour.md § Navigation and scope).
 *
 * Purely presentational: every figure is computed by `lib/positions.ts`
 * and handed in, so the interesting logic is unit-testable without a
 * renderer. The closed-positions disclosure's open/closed flag is the one
 * piece of state that lives here, because nothing outside reads it.
 */
export function PositionsList({
  showTabs,
  tab,
  onSelectTab,
  holdings,
  closedHoldings,
  accounts,
  cash,
  onSelectInstrument,
  onSelectAccount,
  onSelectCash,
  isPending,
  errorMessage,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [showClosed, setShowClosed] = useState(false);

  // Without tabs there is only ever the holdings list: the Accounts tab
  // answers "which accounts do I have", which an account has already
  // answered by being selected.
  const showing: ListTab = showTabs ? tab : "holdings";

  return (
    <View testID="positions-list" style={styles.container}>
      {showTabs ? (
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
      ) : (
        <SectionTitle>Holdings</SectionTitle>
      )}

      {errorMessage ? (
        <Text testID="positions-error" style={styles.error}>
          {errorMessage}
        </Text>
      ) : isPending ? (
        <View testID="positions-loading" style={styles.pending}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : showing === "holdings" ? (
        <>
          {cash ? (
            <ListRow
              testID="cash-row"
              title="Cash"
              subtitle={cash.subtitle}
              value={formatUsd(cash.value)}
              valueTestID="cash-value"
              detail="—"
              detailTestID="cash-detail"
              detailColor={theme.colors.textTertiary}
              onPress={onSelectCash}
            />
          ) : null}

          {holdings.length === 0 && closedHoldings.length === 0 && !cash ? (
            <Text testID="positions-empty" style={styles.empty}>
              Nothing here yet. Add your first buy and it starts charting from
              that date.
            </Text>
          ) : null}

          {holdings.map((row) => (
            <ListRow
              key={row.instrumentId}
              testID={`holding-row-${row.instrumentId}`}
              title={row.symbol}
              subtitle={`${row.name} · ${formatShares(row.shareCount)}`}
              value={row.marketValue === null ? "—" : formatUsd(row.marketValue)}
              valueTestID={`holding-value-${row.instrumentId}`}
              detail={formatPercent(row.changePercent)}
              detailTestID={`holding-percent-${row.instrumentId}`}
              detailColor={changeColor(row.changePercent, theme)}
              onPress={() => onSelectInstrument(row.instrumentId)}
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
                    <ListRow
                      key={row.instrumentId}
                      testID={`closed-row-${row.instrumentId}`}
                      title={row.symbol}
                      subtitle={`${row.name} · closed`}
                      value="—"
                      valueTestID={`closed-value-${row.instrumentId}`}
                      detail={`realized ${formatSigned(row.realizedGain)}`}
                      detailTestID={`closed-realized-${row.instrumentId}`}
                      detailColor={changeColor(row.realizedGain, theme)}
                      onPress={() => onSelectInstrument(row.instrumentId)}
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
            <ListRow
              key={row.accountId}
              testID={`account-row-${row.accountId}`}
              title={row.name}
              subtitle={row.accountType}
              value={row.value === null ? "—" : formatUsd(row.value)}
              valueTestID={`account-value-${row.accountId}`}
              detail={formatPercent(row.changePercent)}
              detailTestID={`account-percent-${row.accountId}`}
              detailColor={changeColor(row.changePercent, theme)}
              onPress={() => onSelectAccount(row.accountId)}
            />
          ))}
        </>
      )}
    </View>
  );
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
