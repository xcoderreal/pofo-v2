import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AllocationBar } from "@/components/AllocationBar";
import { HoldingsMatrix } from "@/components/HoldingsMatrix";
import { changeColor, ListRow, SectionTitle } from "@/components/ListRow";
import { Sparkline } from "@/components/Sparkline";
import { useGrid } from "@/hooks/useGrid";
import { useTheme } from "@/hooks/useTheme";
import { useSharedViewState } from "@/hooks/useViewState";
import { selectFromGrid } from "@/lib/drilldown";
import { formatPercent, formatSigned, formatUsd } from "@/lib/format";
import { signalColors } from "@/utils/theme";

/**
 * The Grid tab — "where is everything", as against the Portfolio tab's
 * "how has it moved".
 *
 * Four sections, all pivots of one batched positions call and two grouped
 * series (see `useGrid`): the total, the allocation bar, the instrument ×
 * account matrix and the account list.
 *
 * Thin by design (CLAUDE.md § "Pages are thin"): every figure comes from
 * `useGrid`, every membership rule from `lib/grid.ts`, and every tap is
 * the pure `selectFromGrid` transition followed by a navigation. That
 * last part is the whole interaction model — the Grid does not have a
 * drill-down of its own, it selects a scope and hands you to the
 * Portfolio tab already looking at it (behaviour.md § Grid).
 */
export default function GridScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const view = useSharedViewState();
  const grid = useGrid();

  const goTo = useCallback(
    (target: { instrumentId: string | null; accountId: string | null }) => {
      view.update(selectFromGrid(view.state, target));
      router.navigate("/");
    },
    [router, view],
  );

  const onSelectCell = useCallback(
    (instrumentId: string, accountId: string) =>
      goTo({ instrumentId, accountId }),
    [goTo],
  );
  const onSelectInstrument = useCallback(
    (instrumentId: string) => goTo({ instrumentId, accountId: null }),
    [goTo],
  );
  const onSelectAccount = useCallback(
    (accountId: string) => goTo({ instrumentId: null, accountId }),
    [goTo],
  );

  if (grid.errorMessage !== null) {
    return (
      <View testID="grid-screen" style={styles.centered}>
        <Text testID="grid-error" style={styles.error}>
          {grid.errorMessage}
        </Text>
      </View>
    );
  }

  if (grid.isPending) {
    return (
      <View testID="grid-screen" style={styles.centered}>
        <ActivityIndicator testID="grid-loading" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      testID="grid-screen"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.eyebrow}>TOTAL PORTFOLIO VALUE</Text>
      <Text testID="grid-total" style={styles.total}>
        {grid.total.value === null ? "—" : formatUsd(grid.total.value)}
      </Text>
      <View style={styles.deltaRow}>
        <Text
          testID="grid-total-change"
          style={[
            styles.delta,
            {
              color:
                grid.total.change === null
                  ? theme.colors.textTertiary
                  : grid.total.change >= 0
                    ? signalColors.up
                    : signalColors.down,
            },
          ]}
        >
          {grid.total.change === null
            ? "—"
            : `${formatSigned(grid.total.change)}  ${formatPercent(
                grid.total.changePercent,
              )}`}
        </Text>
        <Text style={styles.deltaCaption}>past year</Text>
      </View>
      {/* Says out loud what ADR-0001 § 3 makes true — the two halves do
          not overlap, so the sum above is a real total. */}
      <Text style={styles.totalNote}>Holdings plus uninvested cash</Text>

      <View style={styles.section}>
        <SectionTitle>Allocation</SectionTitle>
        <AllocationBar
          segments={grid.allocation}
          onSelectAccount={onSelectAccount}
        />
      </View>

      <View style={styles.section}>
        <SectionTitle>Instruments × accounts</SectionTitle>
        <HoldingsMatrix
          matrix={grid.matrix}
          onSelectCell={onSelectCell}
          onSelectInstrument={onSelectInstrument}
          onSelectAccount={onSelectAccount}
        />
      </View>

      <View style={styles.section}>
        <SectionTitle>Accounts</SectionTitle>
        {grid.accounts.map((row) => (
          <ListRow
            key={row.accountId}
            testID={`grid-account-${row.accountId}`}
            title={row.name}
            subtitle={row.accountType}
            accessory={
              <Sparkline
                testID={`grid-spark-${row.accountId}`}
                points={row.spark}
              />
            }
            value={row.value === null ? "—" : formatUsd(row.value)}
            valueTestID={`grid-account-value-${row.accountId}`}
            detail={formatPercent(row.changePercent)}
            detailTestID={`grid-account-percent-${row.accountId}`}
            detailColor={changeColor(row.changePercent, theme)}
            onPress={() => onSelectAccount(row.accountId)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: { paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.xl },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    eyebrow: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      letterSpacing: 1,
      paddingHorizontal: theme.spacing.lg,
    },
    total: {
      color: theme.colors.text,
      fontSize: 40,
      fontWeight: "600",
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.xs,
    },
    deltaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
    },
    delta: { fontSize: theme.fontSize.lg, fontWeight: "500" },
    deltaCaption: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
    },
    totalNote: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.xs,
    },
    section: { marginTop: theme.spacing.xl },
    error: {
      color: theme.colors.danger,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      textAlign: "center",
    },
  });
}
