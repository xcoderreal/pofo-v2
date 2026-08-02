import { describe, expect, test } from "bun:test";
import {
  buildBars,
  buildPath,
  isRising,
  nearestPointIndex,
  pointXs,
  pointYs,
  type ChartPoint,
} from "@/lib/chart";

function pt(iso: string, value: number): ChartPoint {
  return { timestamp: new Date(`${iso}T00:00:00`), value };
}

/** Pull the x coordinates out of an SVG path's move/line commands. */
function xsOf(path: string): number[] {
  return [...path.matchAll(/[ML]([-\d.]+)\s/g)].map((m) => Number(m[1]));
}

describe("buildPath", () => {
  test("returns empty paths for no points", () => {
    expect(buildPath([], 300, 100)).toEqual({ line: "", area: "" });
  });

  test("derives x from timestamps, not array index", () => {
    // Three points, but the middle one sits 3/4 of the way through the
    // time span — index-based spacing would put it at the halfway mark.
    const points = [
      pt("2026-01-01", 10),
      pt("2026-01-31", 20),
      pt("2026-02-10", 30),
    ];

    const [x0, x1, x2] = xsOf(buildPath(points, 400, 100).line);

    expect(x0).toBe(0);
    expect(x2).toBe(400);
    expect(x1).toBeGreaterThan(280); // 30/40 of the span ≈ 300
    expect(x1).toBeLessThan(320);
  });

  test("sparse points stay proportionally placed — no gap padding needed", () => {
    // A long gap in the middle, as a real ledger has over a market
    // closure. The gap must show as horizontal distance.
    const points = [
      pt("2026-01-01", 100),
      pt("2026-01-02", 100),
      pt("2026-12-31", 100),
    ];

    const [, x1, x2] = xsOf(buildPath(points, 1000, 100).line);

    expect(x1).toBeLessThan(10);
    expect(x2).toBe(1000);
  });

  test("centres a single point rather than dividing by a zero span", () => {
    const [x0] = xsOf(buildPath([pt("2026-01-01", 5)], 300, 100).line);

    expect(x0).toBe(150);
  });

  test("a flat series renders without NaN", () => {
    const points = [pt("2026-01-01", 42), pt("2026-06-01", 42)];

    const { line } = buildPath(points, 300, 100);

    expect(line).not.toContain("NaN");
  });

  test("the area path closes back to the baseline", () => {
    const points = [pt("2026-01-01", 1), pt("2026-02-01", 2)];

    const { area } = buildPath(points, 300, 100);

    expect(area.endsWith("L0 100 Z")).toBe(true);
  });

  test("higher values sit higher on screen (smaller y)", () => {
    const points = [pt("2026-01-01", 10), pt("2026-02-01", 90)];

    const ys = [...buildPath(points, 300, 100).line.matchAll(/[ML][-\d.]+\s([-\d.]+)/g)].map(
      (m) => Number(m[1]),
    );

    expect(ys[1]).toBeLessThan(ys[0]);
  });
});

describe("pointXs", () => {
  test("is the x-axis both renderings share", () => {
    // The bar and line renderers must agree about where a timestamp
    // lands, because #15's nearest-point resolution reads one array and
    // has no idea which of them is on screen.
    const points = [
      pt("2026-01-01", 5),
      pt("2026-01-31", -2),
      pt("2026-02-10", 7),
    ];

    const xs = pointXs(points, 400);

    expect(xs).toEqual(xsOf(buildPath(points, 400, 100).line));
    // A bar's centre, not its left edge.
    const centres = buildBars(points, 400, 100).bars.map(
      (b) => b.x + b.width / 2,
    );
    expect(centres[1]).toBeCloseTo(xs[1], 6);
  });

  test("no points, no positions", () => {
    expect(pointXs([], 400)).toEqual([]);
  });
});

describe("pointYs", () => {
  test("lands exactly on the line's own vertices", () => {
    // The crosshair dot has to sit *on* the line, so the overlay must
    // read the same projection the path was built from rather than
    // re-deriving one that happens to look similar.
    const points = [
      pt("2026-01-01", 10),
      pt("2026-02-01", 90),
      pt("2026-03-01", 40),
    ];

    const ys = pointYs(points, 100);
    const pathYs = [
      ...buildPath(points, 300, 100).line.matchAll(/[ML][-\d.]+\s([-\d.]+)/g),
    ].map((m) => Number(m[1]));

    expect(ys.map((y) => Number(y.toFixed(2)))).toEqual(pathYs);
  });

  test("no points, no positions", () => {
    expect(pointYs([], 100)).toEqual([]);
  });
});

describe("nearestPointIndex", () => {
  test("resolves by timestamp, where the array index gives a different answer", () => {
    // Six monthly points and then a jump to December — the shape a
    // portfolio that stopped trading has. The middle of the chart is
    // physically next to June, which is drawn at ~45% of the width; index
    // arithmetic divides the *count* instead and answers April.
    const points = [
      pt("2026-01-01", 1),
      pt("2026-02-01", 2),
      pt("2026-03-01", 3),
      pt("2026-04-01", 4),
      pt("2026-05-01", 5),
      pt("2026-06-01", 6),
      pt("2026-12-01", 7),
    ];

    const xs = pointXs(points, 1000);
    const resolved = nearestPointIndex(points, 1000, 500);

    expect(resolved).toBe(5);
    expect(points[resolved ?? 0].timestamp.getMonth()).toBe(5); // June
    // The point it picked really is the closest one on screen, and the
    // index-based answer really is a different point.
    expect(Math.abs(xs[5] - 500)).toBeLessThan(Math.abs(xs[6] - 500));
    expect(Math.round(0.5 * (points.length - 1))).toBe(3);
  });

  test("a multi-month hole is empty space, not a compressed run of points", () => {
    // Three dense days and one point eleven months later. Anywhere in the
    // hole resolves to whichever edge is nearer — never to a point that
    // index spacing would have put in the middle.
    const points = [
      pt("2026-01-01", 1),
      pt("2026-01-02", 2),
      pt("2026-01-03", 3),
      pt("2026-12-01", 4),
    ];

    expect(nearestPointIndex(points, 1000, 300)).toBe(2);
    expect(nearestPointIndex(points, 1000, 700)).toBe(3);
    // Index-based resolution would have answered 1 and 2 respectively.
    expect(Math.round(0.3 * 3)).toBe(1);
    expect(Math.round(0.7 * 3)).toBe(2);
  });

  test("a weekend gap resolves to Friday or Monday, never into the gap", () => {
    // Two trading weeks, unpadded across the weekend as the query
    // interface returns them.
    const days = [1, 2, 3, 4, 5, 8, 9, 10, 11, 12];
    const points = days.map((d) =>
      pt(`2026-06-${String(d).padStart(2, "0")}`, d),
    );

    // Just inside the Friday side of the gap and just inside the Monday
    // side of it.
    expect(nearestPointIndex(points, 1100, 420)).toBe(4);
    expect(nearestPointIndex(points, 1100, 580)).toBe(5);
  });

  test("clamps to the ends rather than resolving to nothing", () => {
    const points = [pt("2026-01-01", 1), pt("2026-02-01", 2)];

    // A pointer beyond either edge — reachable on the last pixel, and
    // with a bar whose half-width overhangs the plot.
    expect(nearestPointIndex(points, 300, -40)).toBe(0);
    expect(nearestPointIndex(points, 300, 999)).toBe(1);
  });

  test("a single point answers for the whole width", () => {
    const points = [pt("2026-01-01", 5)];

    expect(nearestPointIndex(points, 300, 0)).toBe(0);
    expect(nearestPointIndex(points, 300, 300)).toBe(0);
  });

  test("no points, nothing to resolve", () => {
    expect(nearestPointIndex([], 300, 150)).toBeNull();
  });

  test("bars and the line resolve identically, because they share one x-axis", () => {
    const points = [
      pt("2026-01-31", 300),
      pt("2026-02-28", -100),
      pt("2026-11-30", 900),
    ];

    // The resolver reads `pointXs`, and a bar is centred on it — so the
    // pointer over a bar's centre resolves to that bar.
    const centres = buildBars(points, 600, 100).bars.map(
      (b) => b.x + b.width / 2,
    );
    centres.forEach((centre, i) => {
      expect(nearestPointIndex(points, 600, centre)).toBe(i);
    });
  });
});

describe("buildBars", () => {
  test("the y-domain always contains zero, even when no value is near it", () => {
    // Three winning months. Scaled to their own extent the smallest would
    // sit *on* the baseline and read as "booked nothing".
    const points = [
      pt("2026-01-31", 400),
      pt("2026-02-28", 900),
      pt("2026-03-31", 1500),
    ];

    const { bars, zeroY } = buildBars(points, 300, 100);

    expect(zeroY).toBeLessThanOrEqual(100);
    expect(zeroY).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.y + bar.height).toBeCloseTo(zeroY, 6);
      expect(bar.height).toBeGreaterThan(1.5);
    }
  });

  test("all-negative buckets hang below a baseline near the top", () => {
    const points = [pt("2026-01-31", -400), pt("2026-02-28", -1500)];

    const { bars, zeroY } = buildBars(points, 300, 100);

    for (const bar of bars) {
      expect(bar.positive).toBe(false);
      expect(bar.y).toBeCloseTo(zeroY, 6);
      expect(bar.height).toBeGreaterThan(0);
    }
    // Zero is the top of the domain, so the baseline sits at the padded
    // top of the chart rather than off-screen.
    expect(zeroY).toBeCloseTo(10, 6);
  });

  test("bars are classified by sign, with zero counting as positive", () => {
    const points = [
      pt("2026-01-31", 500),
      pt("2026-02-28", -500),
      pt("2026-03-31", 0),
    ];

    expect(buildBars(points, 300, 100).bars.map((b) => b.positive)).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("positive bars grow up from the baseline, negative ones down", () => {
    const points = [pt("2026-01-31", 500), pt("2026-02-28", -500)];

    const { bars, zeroY } = buildBars(points, 300, 100);

    // Positive: top edge above the baseline, bottom edge on it.
    expect(bars[0].y).toBeLessThan(zeroY);
    expect(bars[0].y + bars[0].height).toBeCloseTo(zeroY, 6);
    // Negative: top edge on the baseline, bottom below it.
    expect(bars[1].y).toBeCloseTo(zeroY, 6);
    expect(bars[1].y + bars[1].height).toBeGreaterThan(zeroY);
  });

  test("a zero bucket still gets a visible tick, straddling the baseline", () => {
    // The bug this guards against: the tick was anchored with
    // `Math.min(top, zeroY)`, and for a zero bucket `top === zeroY`, so
    // its whole height hung *below* the line — a bucket that booked
    // nothing drawn as a small loss.
    const points = [pt("2026-01-31", 1000), pt("2026-02-28", 0)];

    const { bars, zeroY } = buildBars(points, 300, 100);

    expect(bars[1].height).toBeGreaterThan(0);
    expect(bars[1].y).toBeLessThan(zeroY);
    expect(bars[1].y + bars[1].height).toBeGreaterThan(zeroY);
    expect(bars[1].y + bars[1].height / 2).toBeCloseTo(zeroY, 6);
  });

  test("sparse buckets are placed by date, not by slot", () => {
    // `delta_per_period` drops empty buckets, so a year with gains in
    // January and December comes back as two points. Index-based spacing
    // would put December's bar in the middle of the chart.
    const points = [
      pt("2026-01-31", 300),
      pt("2026-02-28", 100),
      pt("2026-12-31", 900),
    ];

    const centres = buildBars(points, 1000, 100).bars.map(
      (b) => b.x + b.width / 2,
    );

    expect(centres[1] - centres[0]).toBeLessThan(100);
    expect(centres[2] - centres[1]).toBeGreaterThan(700);
  });

  test("bars never overlap and never leave the viewport", () => {
    const points = Array.from({ length: 12 }, (_, i) =>
      pt(`2026-${String(i + 1).padStart(2, "0")}-01`, i % 2 ? -100 : 100),
    );

    const { bars } = buildBars(points, 360, 100);

    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(360);
    }
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].width);
    }
  });

  test("a single bucket is centred and stays a bar rather than a block", () => {
    // The seeded demo has exactly one sell, so one bar is the ordinary
    // case, not a corner one.
    const { bars } = buildBars([pt("2026-03-31", 3420)], 360, 100);

    expect(bars).toHaveLength(1);
    expect(bars[0].x + bars[0].width / 2).toBeCloseTo(180, 6);
    expect(bars[0].width).toBeLessThanOrEqual(28);
  });

  test("no points still yields a baseline to draw", () => {
    const { bars, zeroY } = buildBars([], 300, 100);

    expect(bars).toEqual([]);
    expect(Number.isFinite(zeroY)).toBe(true);
  });

  test("an all-zero series renders without NaN", () => {
    const points = [pt("2026-01-31", 0), pt("2026-02-28", 0)];

    const { bars, zeroY } = buildBars(points, 300, 100);

    expect(Number.isNaN(zeroY)).toBe(false);
    for (const bar of bars) {
      expect(Number.isNaN(bar.y)).toBe(false);
      expect(Number.isNaN(bar.height)).toBe(false);
    }
  });
});
