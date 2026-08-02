/**
 * Pure time-range and granularity logic for the dashboard chart.
 *
 * Zero React imports by design (see CLAUDE.md) — everything here is a
 * plain function over dates, unit-tested directly with `bun test` rather
 * than through a rendered screen.
 *
 * The backend's query interface takes absolute `start`/`end` dates. The
 * UI speaks in relative ranges ("1Y", "YTD", "Max"). Resolving one to
 * the other is this module's job, and it is deliberately the only place
 * that knows today's date, so every consumer stays testable.
 */

/** Relative ranges offered by the chart's control row, in display order. */
export const RANGE_KEYS = [
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "Max",
  "Custom",
] as const;

export type RangeKey = (typeof RANGE_KEYS)[number];

export type Granularity = "daily" | "weekly" | "monthly" | "yearly";

export const GRANULARITIES: readonly Granularity[] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

export interface ResolvedRange {
  start: Date;
  end: Date;
  /** Inclusive day count, used to pick granularity and validate it. */
  spanDays: number;
}

/** Fixed day offsets for the purely relative ranges. */
const FIXED_OFFSET_DAYS: Partial<Record<RangeKey, number>> = {
  "1W": 7,
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "1Y": 365,
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(start: Date, end: Date): number {
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export interface ResolveOptions {
  /** Earliest transaction date, required for "Max". */
  earliest?: Date | null;
  /** Explicit bounds, required for "Custom". */
  custom?: { start: Date; end: Date } | null;
}

/**
 * Turn a range key into the absolute bounds the API wants.
 *
 * `YTD` is computed from Jan 1 of `today`'s year — never a fixed day
 * count, which would be correct on exactly one day of the year.
 *
 * `Max` runs from the earliest transaction. With no transactions there
 * is no history to show, so it collapses to a single day rather than
 * inventing a window.
 */
export function resolveRange(
  key: RangeKey,
  today: Date,
  options: ResolveOptions = {},
): ResolvedRange {
  const end = startOfDay(today);

  if (key === "Custom") {
    if (!options.custom) {
      throw new Error("Custom range requires explicit start and end dates");
    }
    const start = startOfDay(options.custom.start);
    const customEnd = startOfDay(options.custom.end);
    return { start, end: customEnd, spanDays: daysBetween(start, customEnd) };
  }

  if (key === "YTD") {
    const start = new Date(end.getFullYear(), 0, 1);
    return { start, end, spanDays: daysBetween(start, end) };
  }

  if (key === "Max") {
    const start = options.earliest ? startOfDay(options.earliest) : end;
    return { start, end, spanDays: daysBetween(start, end) };
  }

  const offset = FIXED_OFFSET_DAYS[key];
  if (offset === undefined) {
    throw new Error(`Unknown range key: ${key}`);
  }
  const start = new Date(end);
  start.setDate(start.getDate() - offset);
  return { start, end, spanDays: daysBetween(start, end) };
}

/**
 * Minimum span, in days, for a granularity to produce enough buckets to
 * be worth drawing. Below these, a chart would be one or two points.
 */
const MIN_SPAN_DAYS: Record<Granularity, number> = {
  daily: 0,
  weekly: 21,
  monthly: 62,
  yearly: 366,
};

export function isGranularityValid(
  granularity: Granularity,
  spanDays: number,
): boolean {
  return spanDays >= MIN_SPAN_DAYS[granularity];
}

export function validGranularities(spanDays: number): Granularity[] {
  return GRANULARITIES.filter((g) => isGranularityValid(g, spanDays));
}

/**
 * Default granularity for a span.
 *
 * Keyed on the *resolved span* rather than the range's name, so "Max"
 * and "Custom" — whose spans aren't known until resolution — get a
 * sensible default for free, with no extra entries to maintain.
 */
export function autoGranularity(spanDays: number): Granularity {
  if (spanDays <= 45) return "daily";
  if (spanDays <= 200) return "weekly";
  if (spanDays <= 366 * 4) return "monthly";
  return "yearly";
}

/** The API wants plain `YYYY-MM-DD`, in local terms — not an ISO
 * instant, whose UTC shift can move the date across a boundary. */
export function toApiDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Human label under the headline figure, e.g. "past 1 year". */
export function rangeLabel(key: RangeKey): string {
  switch (key) {
    case "1W":
      return "past week";
    case "1M":
      return "past month";
    case "3M":
      return "past 3 months";
    case "6M":
      return "past 6 months";
    case "YTD":
      return "year to date";
    case "1Y":
      return "past year";
    case "Max":
      return "all time";
    case "Custom":
      return "custom range";
  }
}
