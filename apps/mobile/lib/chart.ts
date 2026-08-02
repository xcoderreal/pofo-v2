/**
 * Chart geometry — pure, zero React/React Native imports.
 *
 * Split from components/PortfolioChart.tsx for the reason CLAUDE.md
 * gives for lib/env-core.ts: the maths is what needs testing, and
 * importing the component would drag `react-native` into `bun test`,
 * which cannot parse its Flow types.
 *
 * Two renderings, one x-axis. A Level metric draws as a line and the one
 * Flow metric (`realized_gain`) draws as bars around a zero baseline
 * (docs/design/dashboard_v2/behaviour.md § Metrics), but both place a
 * point at `pointXs()[i]` — the same real-timestamp projection. That is
 * deliberate: the chart's scrub/pin/compare layer resolves the nearest
 * point from the pointer's x against real timestamps, never the array
 * index (behaviour.md § Chart), so it must not need to know which
 * rendering is on screen.
 */

export interface ChartPoint {
  /** Real timestamp — x-position derives from this, never from the array
   * index, so sparse points (non-trading days are not padded) still land
   * proportionally. */
  timestamp: Date;
  value: number;
}

export interface ChartPaths {
  line: string;
  area: string;
}

const PAD_Y = 10;

/**
 * Where each point sits horizontally, in logical pixels.
 *
 * The single source of x for both renderings — and the array a
 * nearest-point resolver reads. A single point centres rather than
 * dividing by a zero span.
 */
export function pointXs(points: ChartPoint[], width: number): number[] {
  if (points.length === 0) return [];

  const times = points.map((p) => p.timestamp.getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = tMax - tMin;

  return times.map((t) => (tSpan === 0 ? width / 2 : ((t - tMin) / tSpan) * width));
}

/**
 * Which point the pointer is over, resolved against **real timestamps**.
 *
 * The inverse of `pointXs`, and the whole reason that function exists
 * separately: the query interface returns sparse, real-timestamped points
 * and deliberately does not gap-pad non-trading days, so the prototype's
 * `Math.round(fraction * (n - 1))` misplaces every point after a gap
 * (behaviour.md § Chart). A series of six monthly points and one in
 * December resolves the middle of the chart to *June*, which is where the
 * sixth point is drawn — index arithmetic answers April.
 *
 * Nearest wins outright, with no hit radius: the pointer is always
 * somewhere, and a gesture that resolved to nothing over a gap would make
 * a sparse series feel broken rather than sparse. Ties go to the earlier
 * point, which only matters when the pointer lands exactly between two.
 *
 * Reads one array and knows nothing about line vs. bars, which is what
 * lets the same resolver serve both renderings.
 */
export function nearestPointIndex(
  points: ChartPoint[],
  width: number,
  x: number,
): number | null {
  if (points.length === 0) return null;

  const xs = pointXs(points, width);
  let best = 0;
  let bestDistance = Math.abs(xs[0] - x);
  for (let i = 1; i < xs.length; i++) {
    const distance = Math.abs(xs[i] - x);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Vertical projection for a set of values.
 *
 * `includeZero` widens the domain to contain the baseline. Bars need it —
 * a chart of three losing months whose axis started at the worst of them
 * would draw three bars all pointing the same way with nothing marking
 * which side of zero they are on.
 */
function valueScale(
  values: number[],
  height: number,
  includeZero: boolean,
): (value: number) => number {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (max - min < 1e-9) {
    // A flat series would divide by zero; centre it instead.
    min -= 1;
    max += 1;
  }
  return (value) =>
    height - PAD_Y - ((value - min) / (max - min)) * (height - PAD_Y * 2);
}

/**
 * Where each point sits vertically in the **line** rendering.
 *
 * The counterpart to `pointXs` for the overlay: a crosshair dot has to
 * land on the vertex it is marking, and re-deriving the scale in the
 * component is how the dot ends up a few pixels off the line the day the
 * padding changes. Bars have no single y to mark — their marker is a
 * full-height rule — so this deliberately covers the line case only, and
 * so does not take `includeZero`.
 */
export function pointYs(points: ChartPoint[], height: number): number[] {
  if (points.length === 0) return [];
  const y = valueScale(
    points.map((p) => p.value),
    height,
    false,
  );
  return points.map((p) => y(p.value));
}

export function buildPath(
  points: ChartPoint[],
  width: number,
  height: number,
): ChartPaths {
  if (points.length === 0) return { line: "", area: "" };

  const y = valueScale(
    points.map((p) => p.value),
    height,
    false,
  );
  const xs = pointXs(points, width);

  const line = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(2)} ${y(p.value).toFixed(2)}`,
    )
    .join(" ");

  return { line, area: `${line} L${width.toFixed(2)} ${height} L0 ${height} Z` };
}

// ─── Bars ─────────────────────────────────────────────────────

export interface Bar {
  /** Left edge of the rect. */
  x: number;
  /** Top edge — above the baseline for a positive value, on it for a
   * negative one. */
  y: number;
  width: number;
  height: number;
  /** Which side of zero, so the renderer can colour it. Zero counts as
   * positive: a flat bucket is not a loss. */
  positive: boolean;
}

export interface BarGeometry {
  bars: Bar[];
  /** The zero baseline's y, in the same space as the bars. Always inside
   * the chart, because the domain always contains zero. */
  zeroY: number;
}

/** The proportion of the gap between two points a bar fills — the
 * prototype's ratio, which leaves a readable gutter at every density. */
const BAR_FILL = 0.62;
const MIN_BAR_WIDTH = 2;
/** A lone bucket would otherwise fill 62% of the chart and read as a
 * block of colour rather than a bar. */
const MAX_BAR_WIDTH = 28;
/** A bucket of exactly zero still gets a tick, so the bar row reads as a
 * sequence of buckets rather than as a gap. */
const MIN_BAR_HEIGHT = 1.5;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Bar geometry around a zero baseline.
 *
 * Bars are *centred* on `pointXs()`, not laid out as evenly-spaced slots:
 * the query interface drops empty buckets from a `delta_per_period`
 * series, so a realized-gain chart is genuinely sparse and index-based
 * spacing would put a bar under the wrong month. Width comes from the
 * tightest gap so neighbours never overlap, and the two edge bars are
 * nudged inside the viewport rather than being clipped in half by it.
 */
export function buildBars(
  points: ChartPoint[],
  width: number,
  height: number,
): BarGeometry {
  if (points.length === 0) return { bars: [], zeroY: height - PAD_Y };

  const y = valueScale(
    points.map((p) => p.value),
    height,
    true,
  );
  const xs = pointXs(points, width);
  const zeroY = y(0);

  let gap = width;
  for (let i = 1; i < xs.length; i++) {
    gap = Math.min(gap, xs[i] - xs[i - 1]);
  }
  const barWidth = clamp(gap * BAR_FILL, MIN_BAR_WIDTH, MAX_BAR_WIDTH);

  const bars = points.map((point, i) => {
    const top = y(point.value);
    const height = Math.max(MIN_BAR_HEIGHT, Math.abs(zeroY - top));
    return {
      x: clamp(xs[i] - barWidth / 2, 0, Math.max(0, width - barWidth)),
      // Anchored to the baseline by *sign*, not by `Math.min(top, zeroY)`:
      // a bucket of exactly zero has `top === zeroY`, so taking the min
      // put its whole MIN_BAR_HEIGHT tick below the line — a nothing
      // bucket drawn as a small loss. Zero straddles instead. For every
      // other value this is the identical result, since a positive bar's
      // top *is* `zeroY - height` and a negative bar's top is `zeroY`.
      y:
        point.value === 0
          ? zeroY - height / 2
          : point.value > 0
            ? zeroY - height
            : zeroY,
      width: barWidth,
      height,
      positive: point.value >= 0,
    };
  });

  return { bars, zeroY };
}

/** Whether the series ended above where it started — drives the accent
 * colour. A series too short to have a direction reads as rising. */
export function isRising(points: ChartPoint[]): boolean {
  if (points.length < 2) return true;
  return points[points.length - 1].value >= points[0].value;
}
