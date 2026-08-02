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

/**
 * One row of the Granularity sheet.
 *
 * Granularity is keyed on the *resolved span*, never the range key's name
 * (behaviour.md § Ranges and granularity), so "Max" and "Custom" get
 * correct options for free — and so the sheet's disabled reasons say
 * "range" rather than naming a key that may not describe the span.
 */
export interface GranularityOption {
  granularity: Granularity;
  label: string;
  note: string;
  selected: boolean;
  disabled: boolean;
}

const BUCKET_NOTE: Record<Granularity, string> = {
  daily: "One point per day",
  weekly: "One point per week",
  monthly: "One point per month",
  yearly: "One point per year",
};

export function buildGranularityOptions(args: {
  spanDays: number;
  /** The explicit override, or null for whatever the span auto-selects. */
  granularity: Granularity | null;
}): GranularityOption[] {
  const auto = autoGranularity(args.spanDays);
  const current = args.granularity ?? auto;

  return GRANULARITIES.map((granularity) => {
    const valid = isGranularityValid(granularity, args.spanDays);
    return {
      granularity,
      label: granularity.charAt(0).toUpperCase() + granularity.slice(1),
      note: !valid
        ? "Too coarse for the selected range"
        : granularity === auto
          ? "Default for this range"
          : BUCKET_NOTE[granularity],
      selected: granularity === current,
      disabled: !valid,
    };
  });
}

/** What one bucket of a granularity is called, for "12 week buckets".
 * Not `granularity.replace("ly", "")`, which is where the prototype's
 * "dai buckets" comes from. */
export function bucketNoun(granularity: Granularity): string {
  switch (granularity) {
    case "daily":
      return "day";
    case "weekly":
      return "week";
    case "monthly":
      return "month";
    case "yearly":
      return "year";
  }
}

/**
 * A Flow's sub-line: how many buckets are on screen, and of what size.
 *
 * This is what stands in for the percentage a Level metric shows, because
 * a percentage against a flow's first bucket is meaningless — divide the
 * year's gains by January's and you get a number that says nothing
 * (behaviour.md § Metrics). The count is the buckets actually drawn, which
 * for `delta_per_period` is the buckets that booked something: the query
 * interface drops empty ones rather than padding, and claiming twelve
 * months when four bars are visible would be describing a different chart.
 */
export function bucketCountLabel(
  count: number,
  granularity: Granularity,
): string {
  const noun = bucketNoun(granularity);
  return `${count} ${noun} bucket${count === 1 ? "" : "s"}`;
}

/**
 * How one point's date is written when the chart is scrubbed or pinned.
 *
 * Keyed on granularity because the bucket *is* the precision: a monthly
 * point labelled "Mar 31, 2026" claims a day's resolution the series does
 * not have, and reads as if the month's whole figure happened on the
 * 31st. A weekly bucket says which week it starts, since "Mar 2" alone
 * would be indistinguishable from a daily point.
 */
export function pointDateLabel(date: Date, granularity: Granularity): string {
  switch (granularity) {
    case "yearly":
      return String(date.getFullYear());
    case "monthly":
      return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    case "weekly":
      return `Week of ${date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`;
    case "daily":
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  }
}

// ─── Custom range ─────────────────────────────────────────────

export type CustomRangeResult =
  | { ok: true; start: string; end: string }
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Real calendar day, written `YYYY-MM-DD`? `new Date("2026-02-31")` rolls
 * into March rather than failing, so the round-trip is the check.
 *
 * Exported because the Custom range sheet and the transaction entry sheet
 * both type their dates rather than pick them, for the same reason
 * (`DateRangeSheet`), and "is 2026-02-31 a day" must not have two answers.
 */
export function isCalendarDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === text
  );
}

/**
 * Validate the Custom range sheet's two fields.
 *
 * Pure, so "what does an empty end date say?" is a unit test rather than a
 * screenshot. A range is only ever committed to `ViewState` once this says
 * `ok` — `resolveRange("Custom", …)` throws without bounds, and a screen
 * that can throw on a typo is not a screen.
 */
export function parseCustomRange(
  startText: string,
  endText: string,
): CustomRangeResult {
  const start = startText.trim();
  const end = endText.trim();

  if (start === "" || end === "") {
    return { ok: false, reason: "Enter both dates as YYYY-MM-DD" };
  }
  if (!isCalendarDate(start) || !isCalendarDate(end)) {
    return { ok: false, reason: "Dates must be real days, as YYYY-MM-DD" };
  }
  if (start > end) {
    return { ok: false, reason: "The start date must come first" };
  }
  return { ok: true, start, end };
}

/** `YYYY-MM-DD` back to a local-midnight `Date`, the inverse of
 * `toApiDate`. The `T00:00:00` matters: bare `new Date("2026-01-01")` is
 * parsed as UTC and can land on the previous day. */
export function fromApiDate(text: string): Date {
  return new Date(`${text}T00:00:00`);
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
