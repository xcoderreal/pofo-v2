import { View } from "react-native";
import Svg, { Defs, LinearGradient, Line, Path, Rect, Stop } from "react-native-svg";
import { buildBars, buildPath, isRising, type ChartPoint } from "@/lib/chart";
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
  testID?: string;
}

export function PortfolioChart({
  points,
  width,
  height = 168,
  variant = "line",
  testID,
}: Props) {
  const theme = useTheme();

  if (variant === "bars") {
    const { bars, zeroY } = buildBars(points, width, height);
    return (
      <View testID={testID}>
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
        </Svg>
      </View>
    );
  }

  const { line, area } = buildPath(points, width, height);
  const stroke = isRising(points) ? signalColors.up : signalColors.down;

  return (
    <View testID={testID}>
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
      </Svg>
    </View>
  );
}
