import { useCallback, useMemo } from "react";
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
import { InstrumentStatCard } from "@/components/InstrumentStatCard";
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
  metricLabel,
  scopeParams,
  selectAccount,
  selectInstrument,
  type ListTab,
  type ScopeChip,
} from "@/lib/drilldown";
import { formatSigned, formatUsd } from "@/lib/format";
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
  RANGE_KEYS,
  rangeLabel,
  resolveRange,
  toApiDate,
  validGranularities,
} from "@/lib/timeseries";
import { signalColors } from "@/utils/theme";

/** Ranges the control row offers directly. "Custom" is reached from the
 * granularity/settings sheet rather than as an eighth pill (#14). */
const PILL_RANGES = RANGE_KEYS.filter((k) => k !== "Custom");

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

  // A single "today" for the render, so the resolved range and every
  // label derived from it agree with each other.
  const today = useMemo(() => new Date(), []);
  const resolved = useMemo(
    () => resolveRange(state.rangeKey, today),
    [state.rangeKey, today],
  );
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

  const series = usePortfolioSeries({
    metric: state.metric,
    ...rangeWindow,
    mode: "point_in_time",
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
    (accountId: string) =>
      view.update(
        selectAccount(state, accountId, {
          holdsInstruments: accountHoldsInstruments({
            positions: positions.data,
            instruments: instruments.data,
            accountId,
          }),
        }),
      ),
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

  const latest = points.length ? points[points.length - 1].value : 0;
  const opening = points.length ? points[0].value : 0;
  const change = latest - opening;
  const pctChange = opening === 0 ? null : (change / Math.abs(opening)) * 100;
  const changeColor = change >= 0 ? signalColors.up : signalColors.down;

  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.screen}>
      <ScrollView
        testID="portfolio-screen"
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <Text testID="metric-label" style={styles.metricLabel}>
          {`${metricLabel(state.metric)}${
            level === "portfolio" ? " · whole portfolio" : ""
          }`.toUpperCase()}
        </Text>

        <ScopeChips chips={chips} onClear={onClearChip} />

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
              {formatUsd(latest)}
            </Text>
            <View style={styles.deltaRow}>
              <Text testID="delta" style={[styles.delta, { color: changeColor }]}>
                {formatSigned(change)}
                {pctChange === null
                  ? ""
                  : `  ${pctChange >= 0 ? "+" : "−"}${Math.abs(pctChange).toFixed(2)}%`}
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
                    // An explicit granularity is per-range; a new range
                    // gets the default for its own span.
                    view.update({ ...state, rangeKey: key, granularity: null })
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

            <View testID="granularity-chip" style={styles.granularityChip}>
              <Text style={styles.granularityText}>
                {granularity.charAt(0).toUpperCase() + granularity.slice(1)}
              </Text>
            </View>

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
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: { flex: 1 },
    content: { paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.xl },
    metricLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      letterSpacing: 1,
      paddingHorizontal: theme.spacing.lg,
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
    // Width matches the toggle that lands in #19, so its arrival is a
    // fill, not a reflow.
    modeSlot: { width: 148, height: 32 },
    fade: { position: "absolute", right: 0, top: 0, bottom: 0 },
  });
}
