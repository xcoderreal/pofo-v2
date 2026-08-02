import { View } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import {
  buildBars,
  buildPath,
  isRising,
  pointXs,
  pointYs,
  type ChartPoint,
} from "@/lib/chart";
import {
  clampSelection,
  IDLE_SELECTION,
  type ChartSelection,
} from "@/lib/chartInteraction";
import type { ChartGestureHandlers } from "@/hooks/useChartSelection";
import { useTheme } from "@/hooks/useTheme";
import { signalColors } from "@/utils/theme";

/**
 * How the series is drawn. A Level metric is a line through instants; the
 * one Flow metric is bars around a zero baseline, because each bucket is
 * an amount booked in an interval rather than a level reached at a moment
 * (docs/design/dashboard_v2/behaviour.md § Metrics).
 */
export type ChartVariant = "line" | "bars";

interface Props {
  points: ChartPoint[];
  /** Rendered width in logical pixels. The viewBox matches, so path
   * coordinates are 1:1 with layout. */
  width: number;
  height?: number;
  variant?: ChartVariant;
  /** What is scrubbed or pinned (#15). Defaults to nothing selected, so
   * a chart that isn't interactive needs no props for it. */
  selection?: ChartSelection;
  /** Spread onto the root view — see `useChartSelection`. */
  gestureHandlers?: ChartGestureHandlers;
  testID?: string;
}

export function PortfolioChart({
  points,
  width,
  height = 168,
  variant = "line",
  selection = IDLE_SELECTION,
  gestureHandlers,
  testID,
}: Props) {
  const theme = useTheme();

  // The two renderings share one x-axis, which is what lets the whole
  // overlay below be built once rather than per variant (lib/chart.ts).
  const xs = pointXs(points, width);
  const active = clampSelection(selection, points.length);
  const pins = [active.pinA, active.pinB].filter(
    (index): index is number => index !== null,
  );
  const band =
    active.pinA !== null && active.pinB !== null
      ? {
          x: Math.min(xs[active.pinA], xs[active.pinB]),
          width: Math.abs(xs[active.pinB] - xs[active.pinA]),
        }
      : null;

  // Bars have no single vertex to mark — a bucket is an interval — so
  // their markers are rules through the bar and the dots are the line's
  // alone.
  const ys = variant === "line" ? pointYs(points, height) : null;

  const overlay = (
    <>
      {band === null ? null : (
        <Rect
          testID={`${testID}-band`}
          x={band.x}
          y={0}
          // A zero-width band would be invisible, and two pins on adjacent
          // points is the ordinary way to compare consecutive buckets.
          width={Math.max(band.width, 1)}
          height={height}
          fill={theme.colors.text}
          fillOpacity={0.08}
        />
      )}
      {pins.map((index, i) => (
        <Line
          key={index}
          testID={`${testID}-pin-${i}`}
          x1={xs[index]}
          y1={0}
          x2={xs[index]}
          y2={height}
          stroke={theme.colors.text}
          strokeOpacity={0.45}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}
      {ys === null
        ? null
        : pins.map((index) => (
            <Circle
              key={index}
              cx={xs[index]}
              cy={ys[index]}
              r={3.5}
              fill={theme.colors.background}
              stroke={theme.colors.text}
              strokeWidth={2}
            />
          ))}
      {active.scrubIndex === null ? null : (
        <>
          <Line
            testID={`${testID}-crosshair`}
            x1={xs[active.scrubIndex]}
            y1={0}
            x2={xs[active.scrubIndex]}
            y2={height}
            stroke={theme.colors.textSecondary}
            strokeWidth={1}
          />
          {ys === null ? null : (
            <Circle
              cx={xs[active.scrubIndex]}
              cy={ys[active.scrubIndex]}
              r={4}
              fill={theme.colors.text}
            />
          )}
        </>
      )}
    </>
  );

  if (variant === "bars") {
    const { bars, zeroY } = buildBars(points, width, height);
    return (
      // The width is pinned rather than left to stretch: the responder's
      // `locationX` is relative to *this* view, and the nearest-point
      // resolver measures against `width`. A view wider than the chart
      // would offset every gesture by the difference.
      <View testID={testID} style={{ width }} {...gestureHandlers}>
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* The baseline is drawn, not implied: with every bar on one
              side of zero its position is the only thing on screen saying
              which side that is. */}
          <Line
            x1={0}
            y1={zeroY}
            x2={width}
            y2={zeroY}
            stroke={theme.colors.border}
            strokeWidth={1}
          />
          {bars.map((bar, i) => (
            <Rect
              // Bars are positional, and the series they come from is
              // replaced wholesale on every range or mode change, so the
              // index is the identity.
              key={i}
              testID={`${testID}-bar-${i}`}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={1}
              fill={bar.positive ? signalColors.up : signalColors.down}
            />
          ))}
          {overlay}
        </Svg>
      </View>
    );
  }

  const { line, area } = buildPath(points, width, height);
  const stroke = isRising(points) ? signalColors.up : signalColors.down;

  return (
    <View testID={testID} style={{ width }} {...gestureHandlers}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity="0.28" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {line ? <Path d={area} fill="url(#chartFill)" /> : null}
        {line ? (
          <Path
            d={line}
            stroke={stroke}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {overlay}
      </Svg>
    </View>
  );
}
