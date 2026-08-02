import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { buildPath, isRising, type ChartPoint } from "@/lib/chart";
import { signalColors } from "@/utils/theme";

interface Props {
  points: ChartPoint[];
  width?: number;
  height?: number;
  testID?: string;
}

/**
 * A row-sized trend line — the Grid's account list.
 *
 * Shares the chart's projection (`buildPath`) rather than carrying its
 * own: a sparkline is the same line at a smaller size, and two copies of
 * the same maths is how the two end up disagreeing about a flat series.
 * The padding is passed explicitly because the full chart's 10px headroom
 * is taller than this whole element.
 *
 * A series with nothing in it renders as blank space of the same size,
 * not as nothing: the column has to stay aligned down the list.
 */
export function Sparkline({ points, width = 68, height = 26, testID }: Props) {
  const { line } = buildPath(points, width, height, 3);

  return (
    <View testID={testID} style={{ width, height }}>
      {line ? (
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Path
            d={line}
            stroke={isRising(points) ? signalColors.up : signalColors.down}
            strokeWidth={1.5}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}
