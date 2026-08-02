import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { AccountBreakdownList } from "@/components/AccountBreakdownList";
import { DateRangeSheet } from "@/components/DateRangeSheet";
import { EntryFab } from "@/components/EntryFab";
import { InstrumentStatCard } from "@/components/InstrumentStatCard";
import { OptionSheet, type SheetOption } from "@/components/OptionSheet";
import { PortfolioChart } from "@/components/PortfolioChart";
import { PositionsList } from "@/components/PositionsList";
import { ScopeChips } from "@/components/ScopeChips";
import { TransactionSheet } from "@/components/TransactionSheet";
import { UndoToast } from "@/components/UndoToast";
import { useDashboard } from "@/hooks/useDashboard";
import { useTheme } from "@/hooks/useTheme";
import { useSharedViewState } from "@/hooks/useViewState";
import { WHOLE_PORTFOLIO_KEY } from "@/lib/accounts";
import {
  clearAccount,
  clearInstrument,
  selectAccount,
  selectInstrument,
  type ListTab,
  type ScopeChip,
} from "@/lib/drilldown";
import {
  buildMetricOptions,
  metricKind,
  metricLabel,
  resolveMetricChoice,
  type Metric,
} from "@/lib/metrics";
import {
  buildGranularityOptions,
  RANGE_KEYS,
  type Granularity,
} from "@/lib/timeseries";
import { signalColors } from "@/utils/theme";

/** Every range is a pill, including Custom — behaviour.md lists it
 * alongside the rest. Custom is the one that opens a sheet instead of
 * applying immediately, because it has bounds to collect first. */
const PILL_RANGES = RANGE_KEYS;

/** Which bottom sheet is open, if any. One slot: they are all modal, so
 * two at once is not a state worth representing. */
type SheetKind = "metric" | "granularity" | "accounts" | "custom" | "entry";

/**
 * The Flow toggle's two segments, as `[cumulative, label]`.
 *
 * They are the query's two Flow modes wearing plain words: `false` is
 * `delta_per_period` ("what each bucket booked") and `true` is
 * `cumulative` ("the running total"). `metricMode` does the translation,
 * so this array never names a `Mode`.
 */
const MODE_SEGMENTS: readonly [cumulative: boolean, label: string][] = [
  [false, "Per period"],
  [true, "Cumulative"],
];

/**
 * The Portfolio tab.
 *
 * Thin by design (CLAUDE.md § "Pages are thin"): every figure on screen
 * is computed by `useDashboard` — which composes the per-resource hooks
 * and the pure functions in `lib/dashboard.ts` and `lib/positions.ts` —
 * and every state transition is a pure `ViewState -> ViewState` in
 * `lib/drilldown.ts`. What is left here is the wiring: which sheet is
 * open, what each control does, and what the JSX looks like.
 */
export default function PortfolioScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width);

  // The four levels are derived from the scope, not routed to: the same
  // screen answers "whole portfolio", "one account", "one instrument" and
  // "one instrument in one account" (behaviour.md § Navigation and scope).
  // Shared with the Grid tab, which selects a scope and then sends you
  // here to read it (behaviour.md § Grid).
  const view = useSharedViewState();
  const { state, level } = view;
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  const dashboard = useDashboard(state, level, chartWidth);
  const { range, chart, lists } = dashboard;
  const isFlow = metricKind(state.metric) === "flow";

  // ─── Transitions ────────────────────────────────────────────

  const onSelectInstrument = useCallback(
    (instrumentId: string) => view.update(selectInstrument(state, instrumentId)),
    [state, view],
  );
  const onSelectAccount = useCallback(
    (accountId: string) => {
      setSheet(null);
      view.update(
        selectAccount(state, accountId, {
          holdsInstruments: dashboard.accountHoldsInstruments(accountId),
        }),
      );
    },
    [state, view, dashboard],
  );
  const onSelectTab = useCallback(
    (tab: ListTab) => view.update({ ...state, tab }),
    [state, view],
  );
  const onSelectCash = useCallback(
    () => view.update({ ...state, metric: "cash_balance" }),
    [state, view],
  );
  const onClearChip = useCallback(
    (kind: ScopeChip["kind"]) =>
      kind === "instrument"
        ? view.updateWithUndo("Instrument filter removed", clearInstrument(state))
        : view.updateWithUndo("Account filter removed", clearAccount(state)),
    [state, view],
  );

  /**
   * Pick a metric, resolving any metric/scope conflict on the way in.
   *
   * The resolver is total, so there is no failure path here: a metric that
   * needs an instrument you don't have never reaches this callback (its
   * row is disabled), and a metric that can't use a chip you do have
   * arrives with that chip already dropped and a message to offer it back
   * (docs/adr/0001-dashboard-v2.md § 6).
   */
  const onSelectMetric = useCallback(
    (metric: Metric) => {
      const choice = resolveMetricChoice(state, metric);
      setSheet(null);
      if (!choice.selectable) return;
      if (choice.undoMessage === null) {
        view.update(choice.next);
      } else {
        view.updateWithUndo(choice.undoMessage, choice.next);
      }
    },
    [state, view],
  );

  const onSelectGranularity = useCallback(
    (next: Granularity) => {
      setSheet(null);
      view.update({ ...state, granularity: next });
    },
    [state, view],
  );

  const onSelectWholePortfolio = useCallback(() => {
    setSheet(null);
    if (state.accountId === null) return;
    view.updateWithUndo("Account filter removed", clearAccount(state));
  }, [state, view]);

  const onApplyCustomRange = useCallback(
    (customRange: { start: string; end: string }) => {
      setSheet(null);
      // A granularity chosen for the old span may be too coarse for this
      // one; null re-derives it from the new span.
      view.update({
        ...state,
        rangeKey: "Custom",
        customRange,
        granularity: null,
      });
    },
    [state, view],
  );

  // ─── Sheet rows ─────────────────────────────────────────────

  const metricOptions = useMemo<SheetOption[]>(
    () =>
      buildMetricOptions(state).map((option) => ({
        key: option.metric,
        label: option.label,
        note: option.note,
        selected: option.selected,
        disabled: option.disabled,
      })),
    [state],
  );

  const granularityOptions = useMemo<SheetOption[]>(
    () =>
      buildGranularityOptions({
        spanDays: range.spanDays,
        granularity: state.granularity,
      }).map((option) => ({
        key: option.granularity,
        label: option.label,
        note: option.note,
        selected: option.selected,
        disabled: option.disabled,
      })),
    [range.spanDays, state.granularity],
  );

  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    // `portfolio-tab` is the whole screen; `portfolio-screen` below is its
    // scroller. The distinction matters to the web tier: expo-router keeps
    // visited tabs mounted and merely stacked, so "what is on this tab" is
    // only answerable by scoping to its root — the same reason the Activity
    // screen has one.
    <View testID="portfolio-tab" style={styles.screen}>
      <ScrollView
        testID="portfolio-screen"
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <Pressable
          testID="metric-button"
          accessibilityRole="button"
          onPress={() => setSheet("metric")}
          style={styles.metricButton}
        >
          <Text testID="metric-label" style={styles.metricLabel}>
            {`${metricLabel(state.metric)}${
              isFlow
                ? " · booked in range"
                : level === "portfolio"
                  ? " · whole portfolio"
                  : ""
            }`.toUpperCase()}
          </Text>
          <Text style={styles.metricCaret}>⌄</Text>
        </Pressable>

        <ScopeChips
          chips={dashboard.chips}
          onClear={onClearChip}
          onOpenAccounts={() => setSheet("accounts")}
        />

        {dashboard.accountIsEmpty ? (
          <View testID="account-empty" style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptySub}>
              Add your first buy or deposit and this account starts charting
              from that date.
            </Text>
          </View>
        ) : chart.isPending ? (
          <View testID="chart-loading" style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Fetching prices…</Text>
          </View>
        ) : chart.errorMessage !== null ? (
          <View testID="chart-error" style={styles.loading}>
            <Text style={styles.errorText}>{chart.errorMessage}</Text>
          </View>
        ) : (
          <>
            <Text testID="big-value" style={styles.bigValue}>
              {chart.headline.value}
            </Text>
            <View style={styles.deltaRow}>
              <Text
                testID="delta"
                style={[
                  styles.delta,
                  {
                    color: chart.headline.rising
                      ? signalColors.up
                      : signalColors.down,
                  },
                ]}
              >
                {chart.headline.delta}
              </Text>
              <Text testID="range-label" style={styles.rangeLabel}>
                {chart.headline.caption}
              </Text>
            </View>

            <PortfolioChart
              testID="portfolio-chart"
              points={chart.points}
              width={chartWidth}
              variant={isFlow ? "bars" : "line"}
              selection={chart.selection}
              gestureHandlers={chart.gestureHandlers}
            />

            {/* Reflects the mode rather than repeating one instruction —
                it is the only thing on screen that says a second tap
                compares (behaviour.md § Chart). */}
            <Text testID="chart-hint" style={styles.hint}>
              {chart.hint}
            </Text>
          </>
        )}

        {/* Control row. Single horizontally scrollable strip with an edge
            fade, so hidden pills are discoverable (#14 / Q9). */}
        <View style={styles.controlRow}>
          <ScrollView
            testID="range-row"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rangeRowContent}
          >
            {PILL_RANGES.map((key) => {
              const active = key === state.rangeKey;
              return (
                <Pressable
                  key={key}
                  testID={`range-${key}`}
                  accessibilityState={{ selected: active }}
                  onPress={() =>
                    key === "Custom"
                      ? // Custom has bounds to collect before it means
                        // anything, so the pill opens a sheet rather than
                        // applying a range that doesn't exist yet.
                        setSheet("custom")
                      : // An explicit granularity is per-range; a new range
                        // gets the default for its own span.
                        view.update({
                          ...state,
                          rangeKey: key,
                          granularity: null,
                        })
                  }
                  style={[styles.pill, active && styles.pillActive]}
                >
                  <Text
                    style={[styles.pillText, active && styles.pillTextActive]}
                  >
                    {key}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable
              testID="granularity-chip"
              accessibilityRole="button"
              onPress={() => setSheet("granularity")}
              style={styles.granularityChip}
            >
              <Text style={styles.granularityText}>
                {range.granularity.charAt(0).toUpperCase() +
                  range.granularity.slice(1)}
              </Text>
              <Text style={styles.granularityCaret}>⌄</Text>
            </Pressable>

            {/* The Per period / Cumulative toggle, in the slot #14
                reserved for it. The slot keeps its size whether or not the
                toggle is in it, so a metric switch fills it rather than
                reflowing the row. */}
            <View testID="mode-slot" style={styles.modeSlot}>
              {isFlow ? (
                <View testID="mode-toggle" style={styles.modeToggle}>
                  {MODE_SEGMENTS.map(([cumulative, label]) => {
                    const key = cumulative ? "cumulative" : "per-period";
                    const active = state.cumulative === cumulative;
                    return (
                      <Pressable
                        key={key}
                        testID={`mode-${key}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => view.update({ ...state, cumulative })}
                        style={[
                          styles.modeSegment,
                          active && styles.modeSegmentActive,
                        ]}
                      >
                        {/* Which segment is on is a colour difference, and
                            a colour difference is not assertable. The
                            marker testID is how the Metric and Granularity
                            sheets already expose their selection. */}
                        <Text
                          testID={active ? `mode-selected-${key}` : undefined}
                          style={[
                            styles.modeText,
                            active && styles.modeTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </ScrollView>

          <Svg
            pointerEvents="none"
            style={styles.fade}
            width={32}
            height={40}
            viewBox="0 0 32 40"
          >
            <Defs>
              <LinearGradient id="rowFade" x1="0" y1="0" x2="1" y2="0">
                <Stop
                  offset="0"
                  stopColor={theme.colors.background}
                  stopOpacity="0"
                />
                <Stop
                  offset="1"
                  stopColor={theme.colors.background}
                  stopOpacity="1"
                />
              </LinearGradient>
            </Defs>
            <Rect width={32} height={40} fill="url(#rowFade)" />
          </Svg>
        </View>

        {dashboard.accountIsEmpty ? null : level === "instrument" ? (
          <>
            {dashboard.stats ? (
              <InstrumentStatCard stats={dashboard.stats} />
            ) : null}
            <AccountBreakdownList
              title="Across your accounts"
              rows={lists.breakdown.live}
              closedRows={lists.breakdown.closed}
              onSelectAccount={onSelectAccount}
              isPending={lists.isPending}
              errorMessage={lists.errorMessage}
              emptyMessage="You don't hold this in any account."
            />
          </>
        ) : (
          <PositionsList
            showTabs={level === "portfolio"}
            tab={state.tab}
            onSelectTab={onSelectTab}
            holdings={lists.holdings.live}
            closedHoldings={lists.holdings.closed}
            accounts={lists.accounts}
            cash={dashboard.cash}
            onSelectInstrument={onSelectInstrument}
            onSelectAccount={onSelectAccount}
            onSelectCash={onSelectCash}
            isPending={lists.isPending}
            errorMessage={lists.errorMessage}
          />
        )}
      </ScrollView>

      {/* Rendered before the sheets so an open sheet covers it — DOM order
          is z-order on web, and everything here is one render tree. */}
      <EntryFab onPress={() => setSheet("entry")} />

      {view.toast ? (
        <UndoToast
          message={view.toast.message}
          onUndo={view.undo}
          onDismiss={view.dismissToast}
        />
      ) : null}

      {sheet === "metric" ? (
        <OptionSheet
          testID="metric-sheet"
          title="Metric"
          subtitle="Applies to the chart and the headline. Options that need an instrument you haven't picked are shown, not hidden."
          options={metricOptions}
          onSelect={(key) => onSelectMetric(key as Metric)}
          onClose={() => setSheet(null)}
        />
      ) : sheet === "granularity" ? (
        <OptionSheet
          testID="granularity-sheet"
          title="Granularity"
          subtitle="The range stays as it is. Only buckets the span can fill are selectable."
          options={granularityOptions}
          onSelect={(key) => onSelectGranularity(key as Granularity)}
          onClose={() => setSheet(null)}
        />
      ) : sheet === "accounts" ? (
        <OptionSheet
          testID="accounts-sheet"
          title="Accounts"
          subtitle="Pick one, or stay on the whole portfolio."
          options={dashboard.accountOptions}
          onSelect={(key) =>
            key === WHOLE_PORTFOLIO_KEY
              ? onSelectWholePortfolio()
              : onSelectAccount(key)
          }
          onClose={() => setSheet(null)}
        />
      ) : sheet === "custom" ? (
        <DateRangeSheet
          initial={state.customRange}
          onApply={onApplyCustomRange}
          onClose={() => setSheet(null)}
        />
      ) : sheet === "entry" ? (
        <TransactionSheet onClose={() => setSheet(null)} />
      ) : null}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: { flex: 1 },
    content: { paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.xl },
    metricButton: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.lg,
    },
    metricLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      letterSpacing: 1,
    },
    metricCaret: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
    },
    bigValue: {
      color: theme.colors.text,
      fontSize: 44,
      fontWeight: "600",
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.xs,
    },
    deltaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
      marginBottom: theme.spacing.lg,
    },
    delta: { fontSize: theme.fontSize.lg, fontWeight: "500" },
    hint: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.sm,
    },
    rangeLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
    },
    loading: {
      minHeight: 220,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing.md,
    },
    loadingText: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      textAlign: "center",
    },
    emptyState: {
      minHeight: 220,
      justifyContent: "center",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.fontSize.xl,
      fontWeight: "600",
    },
    emptySub: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
      lineHeight: 20,
    },
    controlRow: { marginTop: theme.spacing.lg, justifyContent: "center" },
    rangeRowContent: {
      alignItems: "center",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.lg,
    },
    pill: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
    },
    pillActive: { backgroundColor: theme.colors.primary },
    pillText: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.sm,
      fontWeight: "500",
    },
    pillTextActive: { color: theme.colors.primaryText },
    granularityChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.xs,
      marginLeft: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
      backgroundColor: theme.colors.surface,
    },
    granularityText: {
      color: theme.colors.text,
      fontSize: theme.fontSize.sm,
    },
    granularityCaret: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
    },
    // Fixed, and the toggle inside it is `flex: 1` in both directions —
    // the slot's size is what keeps the control row from reflowing when
    // the metric changes, so it must not be derived from its contents.
    modeSlot: { width: 148, height: 32, marginLeft: theme.spacing.sm },
    modeToggle: {
      flex: 1,
      flexDirection: "row",
      borderRadius: 999,
      backgroundColor: theme.colors.surface,
      padding: 2,
    },
    modeSegment: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 999,
    },
    modeSegmentActive: { backgroundColor: theme.colors.border },
    modeText: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      fontWeight: "500",
    },
    modeTextActive: { color: theme.colors.text },
    fade: { position: "absolute", right: 0, top: 0, bottom: 0 },
  });
}
