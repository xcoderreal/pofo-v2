import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { buildPath, isRising, type ChartPoint } from "@/lib/chart";
import { signalColors } from "@/utils/theme";

interface Props {
  points: ChartPoint[];
  /** Rendered width in logical pixels. The viewBox matches, so path
   * coordinates are 1:1 with layout. */
  width: number;
  height?: number;
  testID?: string;
}

export function PortfolioChart({ points, width, height = 168, testID }: Props) {
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
