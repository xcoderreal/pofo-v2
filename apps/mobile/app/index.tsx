import { useMemo, useState } from "react";
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
import { PortfolioChart } from "@/components/PortfolioChart";
import { PositionsList, type ListTab } from "@/components/PositionsList";
import type { ChartPoint } from "@/lib/chart";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { usePortfolioSeries } from "@/hooks/usePortfolio";
import { usePositions } from "@/hooks/usePositions";
import { useTheme } from "@/hooks/useTheme";
import { formatSigned, formatUsd } from "@/lib/format";
import {
  addSeries,
  buildAccountRows,
  buildHoldingRows,
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
  type Granularity,
  type RangeKey,
} from "@/lib/timeseries";
import { signalColors } from "@/utils/theme";

/** Ranges the control row offers directly. "Custom" is reached from the
 * granularity/settings sheet rather than as an eighth pill (#14). */
const PILL_RANGES = RANGE_KEYS.filter((k) => k !== "Custom");

export default function PortfolioScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, width);

  const [rangeKey, setRangeKey] = useState<RangeKey>("1Y");
  const [granularityOverride, setGranularityOverride] =
    useState<Granularity | null>(null);
  const [tab, setTab] = useState<ListTab>("holdings");

  // A single "today" for the render, so the resolved range and every
  // label derived from it agree with each other.
  const today = useMemo(() => new Date(), []);
  const resolved = useMemo(
    () => resolveRange(rangeKey, today),
    [rangeKey, today],
  );
  const granularity =
    granularityOverride && validGranularities(resolved.spanDays).includes(granularityOverride)
      ? granularityOverride
      : autoGranularity(resolved.spanDays);

  const rangeStart = toApiDate(resolved.start);
  const rangeEnd = toApiDate(resolved.end);
  const baseQuery = {
    metric: "equity" as const,
    start: rangeStart,
    end: rangeEnd,
    granularity,
    mode: "point_in_time" as const,
  };

  const series = usePortfolioSeries({ ...baseQuery, groupBy: "none" });

  // Row percentages are range-scoped, so the lists re-fetch with the range
  // exactly as the header does: the positions endpoint supplies each row's
  // current value, and these grouped series supply the denominator it is
  // measured against (docs/design/dashboard_v2/behaviour.md § Percentages).
  //
  // The Accounts tab needs value *including* cash, which is two queries —
  // `equity` deliberately excludes CASH so the two can be added without
  // double-counting (docs/adr/0001-dashboard-v2.md § 3). Both are gated on
  // the tab being on screen; react-query caches, so switching back is free.
  const positions = usePositions();
  const instruments = useInstruments();
  const accounts = useAccounts();

  const byInstrument = usePortfolioSeries(
    { ...baseQuery, groupBy: "instrument" },
    { enabled: tab === "holdings" },
  );
  const equityByAccount = usePortfolioSeries(
    { ...baseQuery, groupBy: "account" },
    { enabled: tab === "accounts" },
  );
  const cashByAccount = usePortfolioSeries(
    { ...baseQuery, metric: "cash_balance", groupBy: "account" },
    { enabled: tab === "accounts" },
  );

  const holdingRows = useMemo(
    () =>
      buildHoldingRows({
        positions: positions.data,
        instruments: instruments.data,
        pointsByInstrument: pointsByGroup(byInstrument.data),
        rangeStart,
      }),
    [positions.data, instruments.data, byInstrument.data, rangeStart],
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

  const listPending =
    positions.isPending ||
    (tab === "holdings"
      ? instruments.isPending || byInstrument.isPending
      : accounts.isPending ||
        equityByAccount.isPending ||
        cashByAccount.isPending);
  const listError =
    positions.error?.message ??
    (tab === "holdings"
      ? (instruments.error?.message ?? byInstrument.error?.message)
      : (accounts.error?.message ??
        equityByAccount.error?.message ??
        cashByAccount.error?.message)) ??
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
    <ScrollView
      testID="portfolio-screen"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Text testID="metric-label" style={styles.metricLabel}>
        EQUITY VALUE · WHOLE PORTFOLIO
      </Text>

      {series.isPending ? (
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
              {rangeLabel(rangeKey)}
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
            const active = key === rangeKey;
            return (
              <Pressable
                key={key}
                testID={`range-${key}`}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setRangeKey(key);
                  // An explicit granularity is per-range; a new range
                  // gets the default for its own span.
                  setGranularityOverride(null);
                }}
                style={[styles.pill, active && styles.pillActive]}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
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

      <PositionsList
        tab={tab}
        onSelectTab={setTab}
        holdings={liveHoldings}
        closedHoldings={closedHoldings}
        accounts={accountRows}
        isPending={listPending}
        errorMessage={listError}
      />
    </ScrollView>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
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
