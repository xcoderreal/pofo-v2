/**
 * The Portfolio screen's derivations, as pure functions.
 *
 * Zero React imports by design (see CLAUDE.md). This module exists
 * because the screen had grown ~420 lines of pre-JSX arithmetic — a range
 * resolution, a headline computation, a level→query-set cascade — none of
 * which `bun test` could reach. Eleven more tickets land on that file, so
 * the maths moved out and the screen went back to calling hooks,
 * handling loading/error and rendering components.
 *
 * Everything here takes its inputs explicitly, including "today", so
 * every rule below is a table-driven test rather than a screenshot.
 */

import type { ChartPoint } from "./chart";
import {
  chartMode,
  clampSelection,
  IDLE_SELECTION,
  type ChartSelection,
} from "./chartInteraction";
import type { Level, ListTab } from "./drilldown";
import { formatPercent } from "./format";
import {
  flowBetween,
  flowTotal,
  formatMetricValue,
  formatSignedMetric,
  metricKind,
  type Metric,
} from "./metrics";
import { changePercent, type SeriesResponse } from "./positions";
import {
  autoGranularity,
  bucketCountLabel,
  bucketNoun,
  fromApiDate,
  pointDateLabel,
  rangeLabel,
  resolveRange,
  toApiDate,
  validGranularities,
  type Granularity,
  type RangeKey,
  type ResolvedRange,
} from "./timeseries";

// ─── Range ────────────────────────────────────────────────────

export interface DashboardRange extends ResolvedRange {
  /** The key actually in force, which is not always the one in
   * `ViewState` — see `resolveDashboardRange`. Everything user-facing
   * (the range label) must read this, not the requested key. */
  key: RangeKey;
  /** The explicit choice if the span can fill it, else the span's own
   * default. */
  granularity: Granularity;
  /** `YYYY-MM-DD` bounds, ready for the query. */
  startDate: string;
  endDate: string;
  /** Whether the range runs to today. Row percentages depend on it: the
   * positions endpoint takes no date, so today's `market_value` is the
   * only range-end value the client has (see `rowChangePercent`). */
  endsToday: boolean;
}

/**
 * Turn the range half of a `ViewState` into everything downstream needs.
 *
 * Two rules the screen used to carry inline, both of which were wrong:
 *
 * 1. **`Max` needs the earliest transaction.** Without it `resolveRange`
 *    falls back to `start = end = today`, so Max charted a single point
 *    reading `+$0.00 +0.00%` under the label "all time"
 *    (behaviour.md § Ranges and granularity). `earliest` being null is a
 *    real state — a portfolio with no transactions genuinely has no
 *    history — and collapses to today honestly.
 * 2. **`Custom` without bounds is not Custom.** `resolveRange` throws
 *    without them, and a screen that throws on a state transition is not
 *    a screen — but the old guard quietly charted 1Y while the label
 *    still said "custom range". The fallback now *renames* the range, so
 *    the label and the data cannot disagree.
 */
export function resolveDashboardRange(args: {
  rangeKey: RangeKey;
  customRange: { start: string; end: string } | null;
  granularity: Granularity | null;
  today: Date;
  earliest: Date | null;
}): DashboardRange {
  const { rangeKey, customRange, granularity, today, earliest } = args;

  const key: RangeKey =
    rangeKey === "Custom" && customRange === null ? "1Y" : rangeKey;

  const resolved = resolveRange(key, today, {
    earliest,
    custom: customRange
      ? {
          start: fromApiDate(customRange.start),
          end: fromApiDate(customRange.end),
        }
      : null,
  });

  const endDate = toApiDate(resolved.end);
  return {
    ...resolved,
    key,
    granularity:
      granularity && validGranularities(resolved.spanDays).includes(granularity)
        ? granularity
        : autoGranularity(resolved.spanDays),
    startDate: toApiDate(resolved.start),
    endDate,
    // `>=`, not `===`: a Custom range may legitimately end in the future,
    // and today's value is still the latest thing that window contains.
    endsToday: endDate >= toApiDate(today),
  };
}

// ─── Chart points ─────────────────────────────────────────────

/**
 * The chart's points, from an ungrouped query response.
 *
 * `group_by=none` collapses everything into one series, so there is
 * either one or none. Timestamps are parsed at local midnight — bare
 * `new Date("2026-01-01")` is read as UTC and can land on the previous
 * day, which would misplace every point relative to the range bounds.
 */
export function toChartPoints(
  series: readonly SeriesResponse[] | undefined,
): ChartPoint[] {
  const first = series?.[0];
  if (!first) return [];
  return first.points.map((p) => ({
    timestamp: fromApiDate(p.timestamp),
    value: Number(p.value),
  }));
}

// ─── Headline ─────────────────────────────────────────────────

export interface Headline {
  /** The big figure. */
  value: string;
  /** The line beneath it: a signed change plus percentage for a Level,
   * or the bucket count for the one Flow. */
  delta: string;
  /**
   * What the delta is measured over — the range's name at rest, and the
   * scrubbed point's date or the compared pair's dates while the chart is
   * being read (behaviour.md § Chart).
   *
   * The screen used to derive this from `range.key` itself. It moved here
   * because the delta and the thing it is measured over have to change
   * together: a caption still reading "past year" beside a delta that is
   * now "January → March" is worse than either alone.
   */
  caption: string;
  /** Which way it went — the accent colour's only input. */
  rising: boolean;
}

/**
 * The headline figure and its sub-line.
 *
 * With nothing selected this is the range's own summary. A scrub, a pin
 * or a compare replaces it with that point's or that pair's figures —
 * which is what makes the chart readable without leaving the screen
 * (behaviour.md § Chart). `selection` defaults to idle so the resting
 * case reads as one call, not as an opt-out.
 *
 * `realized_gain` is the only Flow: its figure is the total booked across
 * the visible range and its sub-line reports the bucket count, because a
 * percentage against a flow's first bucket is meaningless — divide the
 * year's gains by January's and you get a number that says nothing
 * (behaviour.md § Metrics).
 *
 * A Level's sub-line is per-metric formatted, not USD-formatted: a share
 * count going 10 → 15 is `+5`, not `+$5.00`. Its percentage goes through
 * the same `changePercent` every list row uses, rather than a second copy
 * of the rule.
 */
export function buildHeadline(args: {
  metric: Metric;
  cumulative: boolean;
  points: readonly ChartPoint[];
  granularity: Granularity;
  rangeKey: RangeKey;
  selection?: ChartSelection;
}): Headline {
  const { metric, cumulative, points, granularity, rangeKey } = args;
  const values = points.map((point) => point.value);
  const flow = metricKind(metric) === "flow";

  // Indices are only meaningful against the series they were taken from,
  // and a refetch can shorten it under a live pin.
  const selection = clampSelection(args.selection ?? IDLE_SELECTION, points.length);
  const mode = chartMode(selection);
  const label = (index: number) =>
    pointDateLabel(points[index].timestamp, granularity);

  if (mode === "compare" && selection.pinA !== null && selection.pinB !== null) {
    // Sorted, so the delta always reads later-minus-earlier however the
    // two pins were tapped: an A→B change that flipped sign depending on
    // tap order would be describing the chart backwards half the time.
    const lo = Math.min(selection.pinA, selection.pinB);
    const hi = Math.max(selection.pinA, selection.pinB);
    const span = `${label(lo)} → ${label(hi)}`;

    if (flow) {
      const booked = flowBetween(values, lo, hi, cumulative);
      return {
        value: formatSignedMetric(metric, booked),
        delta: `booked over ${bucketCountLabel(hi - lo + 1, granularity)}`,
        caption: span,
        rising: booked >= 0,
      };
    }
    const change = values[hi] - values[lo];
    const percent = changePercent(values[lo], values[hi]);
    return {
      // The chronologically later point, not the second one tapped. The
      // prototype shows B's value while labelling the pair in date order,
      // so tapping right-to-left gave it a figure from the *start* of the
      // span it had just captioned.
      value: formatMetricValue(metric, values[hi]),
      delta: `${formatSignedMetric(metric, change)}${
        percent === null ? "" : `  ${formatPercent(percent)}`
      }`,
      caption: span,
      rising: change >= 0,
    };
  }

  const index = mode === "scrub" ? selection.scrubIndex : selection.pinA;
  if (index !== null) {
    const suffix =
      mode === "pinned" ? " · pinned · tap another point to compare" : "";

    if (flow) {
      // No "vs prev" and no "from start" for a Flow. Both are differences
      // between two independent bucket amounts, which is the comparison
      // behaviour.md § Metrics rules out for the headline percentage — the
      // bucket's own booking, and what kind of bucket it is, is the whole
      // honest readout for a single point.
      return {
        value: formatSignedMetric(metric, values[index]),
        delta: cumulative
          ? "booked to date"
          : `booked this ${bucketNoun(granularity)}`,
        caption: `${label(index)}${suffix}`,
        rising: values[index] >= 0,
      };
    }

    const fromStart = values[index] - values[0];
    if (mode === "pinned") {
      return {
        value: formatMetricValue(metric, values[index]),
        delta: formatSignedMetric(metric, fromStart),
        caption: `${label(index)}${suffix}`,
        rising: fromStart >= 0,
      };
    }
    // Scrubbing: the near-term move is what the finger is chasing, so
    // that leads and the range-start comparison rides in the caption.
    const previous = index > 0 ? values[index - 1] : values[0];
    const change = values[index] - previous;
    return {
      value: formatMetricValue(metric, values[index]),
      delta: `${formatSignedMetric(metric, change)} vs prev`,
      caption: `${label(index)} · ${formatSignedMetric(
        metric,
        fromStart,
      )} from start`,
      rising: change >= 0,
    };
  }

  if (flow) {
    const booked = flowTotal(values, cumulative);
    return {
      value: formatSignedMetric(metric, booked),
      delta: bucketCountLabel(points.length, granularity),
      caption: rangeLabel(rangeKey),
      rising: booked >= 0,
    };
  }

  const latest = values.length ? values[values.length - 1] : 0;
  const opening = values.length ? values[0] : 0;
  const change = latest - opening;
  const percent = changePercent(opening, latest);

  return {
    value: formatMetricValue(metric, latest),
    delta: `${formatSignedMetric(metric, change)}${
      percent === null ? "" : `  ${formatPercent(percent)}`
    }`,
    caption: rangeLabel(rangeKey),
    rising: change >= 0,
  };
}

// ─── Which lists are on screen ────────────────────────────────

export interface ListVisibility {
  /** Holdings rows — the portfolio level's Holdings tab, and every row
   * an account or slice shows. */
  holdings: boolean;
  /** The portfolio level's Accounts tab. */
  accounts: boolean;
  /** The instrument level's "Across your accounts" breakdown. */
  breakdown: boolean;
}

/**
 * Which of the three grouped series the current level actually needs.
 *
 * Each one gates a query. That gating is not an optimisation: a disabled
 * react-query sits in `pending` forever, so folding all of them into one
 * loading flag would pin the list on its spinner at every level.
 *
 * Exactly one is true, always — the four levels partition into three
 * lists (a slice shows a holdings row like an account does).
 */
export function listVisibility(level: Level, tab: ListTab): ListVisibility {
  return {
    holdings:
      (level === "portfolio" && tab === "holdings") ||
      level === "account" ||
      level === "slice",
    accounts: level === "portfolio" && tab === "accounts",
    breakdown: level === "instrument",
  };
}

/**
 * The first message among the queries that are actually on screen.
 *
 * Undefined entries are skipped rather than treated as "no error", so a
 * caller can pass the full set and let visibility decide.
 */
export function firstError(
  messages: readonly (string | undefined | null)[],
): string | null {
  return messages.find((message) => Boolean(message)) ?? null;
}
