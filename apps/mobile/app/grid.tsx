import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  DeleteAccountSheet,
  NewAccountSheet,
} from "@/components/AccountSheet";
import { AllocationBar } from "@/components/AllocationBar";
import { HoldingsMatrix } from "@/components/HoldingsMatrix";
import { changeColor, ListRow, SectionTitle } from "@/components/ListRow";
import { OptionSheet } from "@/components/OptionSheet";
import { Sparkline } from "@/components/Sparkline";
import { useGrid } from "@/hooks/useGrid";
import { useTheme } from "@/hooks/useTheme";
import { useSharedViewState } from "@/hooks/useViewState";
import { buildAccountRemovalOptions } from "@/lib/accounts";
import { accountDeleted, selectFromGrid } from "@/lib/drilldown";
import { formatPercent, formatSigned, formatUsd } from "@/lib/format";
import { signalColors } from "@/utils/theme";

/**
 * Which account sheet is open, if any.
 *
 * Removal is two states, not one: picking *which* account, then confirming
 * *that* account. Collapsing them would mean either a destructive control
 * on every list row or a confirmation that has to ask two questions at
 * once.
 */
type AccountSheet =
  | { kind: "new" }
  | { kind: "pick-removal" }
  | { kind: "confirm-removal"; accountId: string };

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
  const [sheet, setSheet] = useState<AccountSheet | null>(null);

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

  const removalOptions = useMemo(
    () => buildAccountRemovalOptions(grid.accounts),
    [grid.accounts],
  );

  /**
   * #24 AC 7. The shared view state may be scoped to the account that just
   * stopped existing — including from the *other* tab, which is the whole
   * reason the scope lives above the navigator — so the fallback is applied
   * here rather than being left for the Portfolio screen to notice.
   *
   * `view.update`, not `updateWithUndo`: there is nothing to offer back.
   */
  const onAccountDeleted = useCallback(
    (accountId: string) => view.update(accountDeleted(view.state, accountId)),
    [view],
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
    // A root `View` so the sheets — absolutely positioned overlays inside
    // the screen, not RN `Modal`s — cover the scroller rather than
    // scrolling with it. Same shape as the Portfolio tab.
    <View testID="grid-screen" style={styles.screen}>
      <ScrollView
        testID="grid-scroll"
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

          {/* One of #24 AC 2's two required entry points — the other is
              the Portfolio tab's Accounts sheet. Both are permanent, so
              creating an account is never an onboarding-only step. */}
          <Pressable
            testID="grid-add-account"
            accessibilityRole="button"
            onPress={() => setSheet({ kind: "new" })}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>＋ Add an account</Text>
          </Pressable>

          {/* Deliberately its own row rather than a control on each
              account above: a destructive action inside a list whose rows
              navigate is one mis-aimed thumb from being pressed. */}
          <Pressable
            testID="grid-remove-account"
            accessibilityRole="button"
            disabled={grid.accounts.length === 0}
            onPress={() => setSheet({ kind: "pick-removal" })}
            style={[
              styles.action,
              grid.accounts.length === 0 && styles.actionDisabled,
            ]}
          >
            <Text style={[styles.actionLabel, styles.actionDanger]}>
              Remove an account
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {sheet?.kind === "new" ? (
        <NewAccountSheet onClose={() => setSheet(null)} />
      ) : sheet?.kind === "pick-removal" ? (
        <OptionSheet
          testID="account-removal-sheet"
          title="Remove an account"
          subtitle="Pick one. The next step states exactly what deleting it destroys, and asks you to type its name."
          options={removalOptions}
          onSelect={(accountId) =>
            setSheet({ kind: "confirm-removal", accountId })
          }
          onClose={() => setSheet(null)}
        />
      ) : sheet?.kind === "confirm-removal" ? (
        <DeleteAccountSheet
          accountId={sheet.accountId}
          onClose={() => setSheet(null)}
          onDeleted={onAccountDeleted}
        />
      ) : null}
    </View>
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
    action: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderLight,
    },
    actionDisabled: { opacity: 0.38 },
    actionLabel: {
      color: theme.colors.primary,
      fontSize: theme.fontSize.md,
      fontWeight: "500",
    },
    actionDanger: { color: theme.colors.danger },
    error: {
      color: theme.colors.danger,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      textAlign: "center",
    },
  });
}
