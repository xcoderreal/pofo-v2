/**
 * Chart geometry — pure, zero React/React Native imports.
 *
 * Split from components/PortfolioChart.tsx for the reason CLAUDE.md
 * gives for lib/env-core.ts: the maths is what needs testing, and
 * importing the component would drag `react-native` into `bun test`,
 * which cannot parse its Flow types.
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

export function buildPath(
  points: ChartPoint[],
  width: number,
  height: number,
): ChartPaths {
  if (points.length === 0) return { line: "", area: "" };

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-9) {
    // A flat series would divide by zero; centre it instead.
    min -= 1;
    max += 1;
  }

  const times = points.map((p) => p.timestamp.getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = tMax - tMin;

  const x = (t: number) => (tSpan === 0 ? width / 2 : ((t - tMin) / tSpan) * width);
  const y = (v: number) =>
    height - PAD_Y - ((v - min) / (max - min)) * (height - PAD_Y * 2);

  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(p.timestamp.getTime()).toFixed(2)} ${y(
          p.value,
        ).toFixed(2)}`,
    )
    .join(" ");

  return { line, area: `${line} L${width.toFixed(2)} ${height} L0 ${height} Z` };
}

/** Whether the series ended above where it started — drives the accent
 * colour. A series too short to have a direction reads as rising. */
export function isRising(points: ChartPoint[]): boolean {
  if (points.length < 2) return true;
  return points[points.length - 1].value >= points[0].value;
}
