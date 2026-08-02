import { describe, expect, test } from "bun:test";
import { buildPath, isRising, type ChartPoint } from "@/lib/chart";

function pt(iso: string, value: number): ChartPoint {
  return { timestamp: new Date(`${iso}T00:00:00`), value };
}

/** Pull the x coordinates out of an SVG path's move/line commands. */
function xs(path: string): number[] {
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

    const [x0, x1, x2] = xs(buildPath(points, 400, 100).line);

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

    const [, x1, x2] = xs(buildPath(points, 1000, 100).line);

    expect(x1).toBeLessThan(10);
    expect(x2).toBe(1000);
  });

  test("centres a single point rather than dividing by a zero span", () => {
    const [x0] = xs(buildPath([pt("2026-01-01", 5)], 300, 100).line);

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
