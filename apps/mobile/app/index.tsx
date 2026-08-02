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
import { InstrumentStatCard } from "@/components/InstrumentStatCard";
import { OptionSheet, type SheetOption } from "@/components/OptionSheet";
import { PortfolioChart } from "@/components/PortfolioChart";
import { PositionsList } from "@/components/PositionsList";
import { ScopeChips } from "@/components/ScopeChips";
import { UndoToast } from "@/components/UndoToast";
import type { ChartPoint } from "@/lib/chart";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { usePortfolioSeries } from "@/hooks/usePortfolio";
import { usePositions } from "@/hooks/usePositions";
import { useTheme } from "@/hooks/useTheme";
import { useViewState } from "@/hooks/useViewState";
import {
  buildChips,
  clearAccount,
  clearInstrument,
  scopeParams,
  selectAccount,
  selectInstrument,
  type ListTab,
  type ScopeChip,
} from "@/lib/drilldown";
import { formatSigned } from "@/lib/format";
import {
  buildMetricOptions,
  formatMetricValue,
  metricKind,
  metricLabel,
  metricMode,
  resolveMetricChoice,
  type Metric,
} from "@/lib/metrics";
import {
  accountHoldsInstruments,
  addSeries,
  buildAccountRows,
  buildHoldingRows,
  buildInstrumentAccountRows,
  buildInstrumentStats,
  cashBalanceFor,
  pointsByGroup,
  splitClosed,
} from "@/lib/positions";
import {
  autoGranularity,
  bucketNoun,
  buildGranularityOptions,
  fromApiDate,
  RANGE_KEYS,
  rangeLabel,
  resolveRange,
  toApiDate,
  validGranularities,
  type Granularity,
} from "@/lib/timeseries";
import { signalColors } from "@/utils/theme";

/** Every range is a pill, including Custom — behaviour.md lists it
 * alongside the rest. Custom is the one that opens a sheet instead of
 * applying immediately, because it has bounds to collect first. */
const PILL_RANGES = RANGE_KEYS;

/** Which bottom sheet is open, if any. One slot: they are all modal, so
 * two at once is not a state worth representing. */
type SheetKind = "metric" | "granularity" | "accounts" | "custom";

/** The Accounts sheet's "no account filter" row. Not an account id, so it
 * cannot collide with one. */
const WHOLE_PORTFOLIO = "__all__";

/** Below this, an account's cash is rounding dust rather than a balance
 * worth its own row — the prototype's own threshold. */
const CASH_ROW_THRESHOLD = 1;

export default function PortfolioScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width);

  // The four levels are derived from the scope, not routed to: the same
  // screen answers "whole portfolio", "one account", "one instrument" and
  // "one instrument in one account" (behaviour.md § Navigation and scope).
  const view = useViewState();
  const { state, level } = view;
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  // A single "today" for the render, so the resolved range and every
  // label derived from it agree with each other.
  const today = useMemo(() => new Date(), []);
  const resolved = useMemo(() => {
    // `resolveRange` throws on Custom without bounds, and a screen that
    // can throw on a state transition is not a screen. The two always
    // move together (the Custom sheet sets both), so this is a guard
    // rather than a branch anyone reaches.
    if (state.rangeKey === "Custom" && state.customRange === null) {
      return resolveRange("1Y", today);
    }
    return resolveRange(state.rangeKey, today, {
      custom: state.customRange
        ? {
            start: fromApiDate(state.customRange.start),
            end: fromApiDate(state.customRange.end),
          }
        : null,
    });
  }, [state.rangeKey, state.customRange, today]);
  const granularity =
    state.granularity &&
    validGranularities(resolved.spanDays).includes(state.granularity)
      ? state.granularity
      : autoGranularity(resolved.spanDays);

  const rangeStart = toApiDate(resolved.start);
  const rangeEnd = toApiDate(resolved.end);
  const rangeWindow = { start: rangeStart, end: rangeEnd, granularity };
  const listQuery = {
    // The lists' denominators are always about *value*, whatever the
    // chart above them is plotting — a row's percentage is the change in
    // what it is worth (behaviour.md § Percentages).
    metric: "equity" as const,
    ...rangeWindow,
    mode: "point_in_time" as const,
  };

  const instruments = useInstruments();
  const accounts = useAccounts();

  // One unscoped positions call feeds every level. The rows are keyed by
  // (account, instrument), so narrowing is a filter rather than a
  // refetch — which is what makes drilling in instant and keeps the
  // stat card, the lists and (from #20) the Grid matrix reading the same
  // batched call (docs/adr/0001-dashboard-v2.md § 5).
  const positions = usePositions();
  const scopedPositions = useMemo(
    () =>
      (positions.data ?? []).filter(
        (row) =>
          (state.accountId === null || row.account_id === state.accountId) &&
          (state.instrumentId === null ||
            row.instrument_id === state.instrumentId),
      ),
    [positions.data, state.accountId, state.instrumentId],
  );

  // A Level is queried at an instant and a Flow over an interval; the API
  // rejects the wrong pairing (docs/domain-model.md § (Metric, Mode)
  // validity), so the mode follows the metric rather than being fixed.
  const series = usePortfolioSeries({
    metric: state.metric,
    ...rangeWindow,
    mode: metricMode(state.metric, state.cumulative),
    groupBy: "none",
    ...scopeParams(state),
  });

  // Row percentages are range-scoped, so the lists re-fetch with the
  // range exactly as the header does: the positions endpoint supplies
  // each row's current value, and these grouped series supply the
  // denominator it is measured against.
  //
  // Which grouping is needed depends on the level — by instrument for a
  // holdings list, by account for the instrument level's breakdown — and
  // each is gated on being on screen. react-query caches, so stepping
  // back up a level is free.
  const wantsHoldings =
    (level === "portfolio" && state.tab === "holdings") ||
    level === "account" ||
    level === "slice";
  const wantsAccountsTab = level === "portfolio" && state.tab === "accounts";
  const wantsBreakdown = level === "instrument";

  const byInstrument = usePortfolioSeries(
    {
      ...listQuery,
      groupBy: "instrument",
      accounts: state.accountId ? [state.accountId] : undefined,
      instruments: state.instrumentId ? [state.instrumentId] : undefined,
    },
    { enabled: wantsHoldings },
  );
  // The Accounts tab needs value *including* cash, which is two queries —
  // `equity` deliberately excludes CASH so the two can be added without
  // double-counting (docs/adr/0001-dashboard-v2.md § 3).
  const equityByAccount = usePortfolioSeries(
    { ...listQuery, groupBy: "account" },
    { enabled: wantsAccountsTab },
  );
  const cashByAccount = usePortfolioSeries(
    { ...listQuery, metric: "cash_balance", groupBy: "account" },
    { enabled: wantsAccountsTab },
  );
  const byAccountForInstrument = usePortfolioSeries(
    {
      ...listQuery,
      groupBy: "account",
      instruments: state.instrumentId ? [state.instrumentId] : undefined,
    },
    { enabled: wantsBreakdown },
  );

  // ─── Rows ───────────────────────────────────────────────────

  const holdingRows = useMemo(
    () =>
      buildHoldingRows({
        positions: scopedPositions,
        instruments: instruments.data,
        pointsByInstrument: pointsByGroup(byInstrument.data),
        rangeStart,
      }),
    [scopedPositions, instruments.data, byInstrument.data, rangeStart],
  );
  const { live: liveHoldings, closed: closedHoldings } = useMemo(
    () => splitClosed(holdingRows),
    [holdingRows],
  );

  const accountRows = useMemo(() => {
    const equity = pointsByGroup(equityByAccount.data);
    const cash = pointsByGroup(cashByAccount.data);
    const combined: Record<string, ReturnType<typeof addSeries>> = {};
    for (const id of new Set([...Object.keys(equity), ...Object.keys(cash)])) {
      combined[id] = addSeries(equity[id], cash[id]);
    }
    return buildAccountRows({
      positions: positions.data,
      accounts: accounts.data,
      pointsByAccount: combined,
      rangeStart,
    });
  }, [
    positions.data,
    accounts.data,
    equityByAccount.data,
    cashByAccount.data,
    rangeStart,
  ]);

  const breakdownRows = useMemo(
    () =>
      state.instrumentId === null
        ? []
        : buildInstrumentAccountRows({
            positions: scopedPositions,
            accounts: accounts.data,
            instrumentId: state.instrumentId,
            pointsByAccount: pointsByGroup(byAccountForInstrument.data),
            rangeStart,
          }),
    [
      scopedPositions,
      accounts.data,
      state.instrumentId,
      byAccountForInstrument.data,
      rangeStart,
    ],
  );
  const { live: liveBreakdown, closed: closedBreakdown } = useMemo(
    () => splitClosed(breakdownRows),
    [breakdownRows],
  );

  const stats = useMemo(
    () =>
      state.instrumentId === null
        ? null
        : buildInstrumentStats(scopedPositions, state.instrumentId),
    [scopedPositions, state.instrumentId],
  );

  const cashValue =
    level === "account" && state.accountId !== null
      ? cashBalanceFor({
          positions: positions.data,
          instruments: instruments.data,
          accountId: state.accountId,
        })
      : null;
  const showCashRow =
    cashValue !== null && Math.abs(cashValue) >= CASH_ROW_THRESHOLD;

  // An account with no holdings — live or closed — and no cash has
  // nothing to chart: the equity series would be a flat zero, which reads
  // as a broken screen rather than as an empty one.
  const accountIsEmpty =
    level === "account" &&
    positions.isSuccess &&
    holdingRows.length === 0 &&
    !showCashRow;

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
          holdsInstruments: accountHoldsInstruments({
            positions: positions.data,
            instruments: instruments.data,
            accountId,
          }),
        }),
      );
    },
    [state, view, positions.data, instruments.data],
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
        spanDays: resolved.spanDays,
        granularity: state.granularity,
      }).map((option) => ({
        key: option.granularity,
        label: option.label,
        note: option.note,
        selected: option.selected,
        disabled: option.disabled,
      })),
    [resolved.spanDays, state.granularity],
  );

  const accountOptions = useMemo<SheetOption[]>(
    () => [
      {
        key: WHOLE_PORTFOLIO,
        label: "Whole portfolio",
        note: `All ${(accounts.data ?? []).length} accounts combined`,
        selected: state.accountId === null,
      },
      ...(accounts.data ?? []).map((account) => ({
        key: account.id,
        label: account.name,
        note: `${account.institution} · ${account.account_type}`,
        selected: state.accountId === account.id,
      })),
    ],
    [accounts.data, state.accountId],
  );

  const chips = useMemo(
    () =>
      buildChips({
        scope: state,
        instruments: instruments.data,
        accounts: accounts.data,
      }),
    [state, instruments.data, accounts.data],
  );

  // ─── Pending / error, per level ─────────────────────────────
  // Only the queries actually enabled for this level are consulted: a
  // disabled react-query sits in `pending` forever, so folding them all
  // together would pin the list on its spinner.

  const listPending =
    positions.isPending ||
    (wantsAccountsTab
      ? accounts.isPending ||
        equityByAccount.isPending ||
        cashByAccount.isPending
      : wantsBreakdown
        ? accounts.isPending || byAccountForInstrument.isPending
        : instruments.isPending || byInstrument.isPending);
  const listError =
    positions.error?.message ??
    (wantsAccountsTab
      ? (accounts.error?.message ??
        equityByAccount.error?.message ??
        cashByAccount.error?.message)
      : wantsBreakdown
        ? (accounts.error?.message ?? byAccountForInstrument.error?.message)
        : (instruments.error?.message ?? byInstrument.error?.message)) ??
    null;

  const points: ChartPoint[] = useMemo(() => {
    const first = series.data?.[0];
    if (!first) return [];
    return first.points.map((p) => ({
      timestamp: new Date(`${p.timestamp}T00:00:00`),
      value: Number(p.value),
    }));
  }, [series.data]);

  // `realized_gain` is the only Flow: its headline is the total booked
  // across the visible range, and its sub-line reports the range and
  // bucket count — a percentage against a flow's first bucket is
  // meaningless (behaviour.md § Metrics). The bars and the per-period /
  // cumulative toggle are #19; this is the line-shaped version of it.
  const isFlow = metricKind(state.metric) === "flow";
  const latest = points.length ? points[points.length - 1].value : 0;
  const opening = points.length ? points[0].value : 0;
  const booked = points.reduce((total, point) => total + point.value, 0);
  const headline = isFlow
    ? formatSigned(state.cumulative ? latest : booked)
    : formatMetricValue(state.metric, latest);
  const change = latest - opening;
  const pctChange = opening === 0 ? null : (change / Math.abs(opening)) * 100;
  const changeColor = isFlow
    ? (state.cumulative ? latest : booked) >= 0
      ? signalColors.up
      : signalColors.down
    : change >= 0
      ? signalColors.up
      : signalColors.down;

  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.screen}>
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
          chips={chips}
          onClear={onClearChip}
          onOpenAccounts={() => setSheet("accounts")}
        />

        {accountIsEmpty ? (
          <View testID="account-empty" style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptySub}>
              Add your first buy or deposit and this account starts charting
              from that date.
            </Text>
          </View>
        ) : series.isPending ? (
          <View testID="chart-loading" style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.loadingText}>Fetching prices…</Text>
          </View>
        ) : series.isError ? (
          <View testID="chart-error" style={styles.loading}>
            <Text style={styles.errorText}>{series.error.message}</Text>
          </View>
        ) : (
          <>
            <Text testID="big-value" style={styles.bigValue}>
              {headline}
            </Text>
            <View style={styles.deltaRow}>
              <Text testID="delta" style={[styles.delta, { color: changeColor }]}>
                {isFlow
                  ? `${points.length} ${bucketNoun(granularity)} buckets`
                  : `${formatSigned(change)}${
                      pctChange === null
                        ? ""
                        : `  ${pctChange >= 0 ? "+" : "−"}${Math.abs(pctChange).toFixed(2)}%`
                    }`}
              </Text>
              <Text testID="range-label" style={styles.rangeLabel}>
                {rangeLabel(state.rangeKey)}
              </Text>
            </View>

            <PortfolioChart
              testID="portfolio-chart"
              points={points}
              width={chartWidth}
            />
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
                {granularity.charAt(0).toUpperCase() + granularity.slice(1)}
              </Text>
              <Text style={styles.granularityCaret}>⌄</Text>
            </Pressable>

            {/* Reserved slot for the Per period / Cumulative toggle that
                arrives with realized gain (#19). Present but empty, so
                switching metric never reflows this row. */}
            <View testID="mode-slot" style={styles.modeSlot} />
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

        {accountIsEmpty ? null : level === "instrument" ? (
          <>
            {stats ? <InstrumentStatCard stats={stats} /> : null}
            <AccountBreakdownList
              title="Across your accounts"
              rows={liveBreakdown}
              closedRows={closedBreakdown}
              onSelectAccount={onSelectAccount}
              isPending={listPending}
              errorMessage={listError}
              emptyMessage="You don't hold this in any account."
            />
          </>
        ) : (
          <PositionsList
            showTabs={level === "portfolio"}
            tab={state.tab}
            onSelectTab={onSelectTab}
            holdings={liveHoldings}
            closedHoldings={closedHoldings}
            accounts={accountRows}
            cash={
              showCashRow && cashValue !== null
                ? {
                    value: cashValue,
                    subtitle: liveHoldings.length
                      ? "Uninvested"
                      : "No instruments in this account",
                  }
                : null
            }
            onSelectInstrument={onSelectInstrument}
            onSelectAccount={onSelectAccount}
            onSelectCash={onSelectCash}
            isPending={listPending}
            errorMessage={listError}
          />
        )}
      </ScrollView>

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
          options={accountOptions}
          onSelect={(key) =>
            key === WHOLE_PORTFOLIO
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
    // Width matches the toggle that lands in #19, so its arrival is a
    // fill, not a reflow.
    modeSlot: { width: 148, height: 32 },
    fade: { position: "absolute", right: 0, top: 0, bottom: 0 },
  });
}
