import { useCallback, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import { nearestPointIndex, type ChartPoint } from "@/lib/chart";
import {
  beginScrub,
  cancelScrub,
  chartHint,
  endGesture,
  IDLE_SELECTION,
  isDrag,
  moveScrub,
  type ChartSelection,
} from "@/lib/chartInteraction";

/**
 * The React Native responder props the chart spreads onto its root view.
 *
 * The responder system rather than `PanResponder` or a web-only pointer
 * handler: it is the one gesture API that is native on iOS and mouse *and*
 * touch on react-native-web, which is what lets one implementation serve
 * the device and the Playwright spec that proves it works.
 */
export interface ChartGestureHandlers {
  onStartShouldSetResponder: () => boolean;
  onMoveShouldSetResponder: () => boolean;
  onResponderGrant: (event: GestureResponderEvent) => void;
  onResponderMove: (event: GestureResponderEvent) => void;
  onResponderRelease: (event: GestureResponderEvent) => void;
  onResponderTerminate: () => void;
}

export interface ChartInteraction {
  selection: ChartSelection;
  /** The line under the chart, describing the mode currently in force. */
  hint: string;
  handlers: ChartGestureHandlers;
}

/**
 * Scrub, pin and A→B compare on the chart (#15).
 *
 * Holds the two mutable things the pure machine in `lib/chartInteraction`
 * cannot: the selection itself, and the *press* — where it started and
 * whether it has travelled far enough to stop being a tap. The press is a
 * ref rather than state because nothing renders from it; putting it in
 * state would re-render the whole dashboard on every pointer move for a
 * value only the release reads.
 *
 * `resetKey` is every input the selection is meaningful against
 * (`selectionResetKey`). Comparing it during render rather than clearing
 * from an effect is deliberate: an effect would let one frame paint a pin
 * from the old series over the new one, and the readout would show a
 * figure that is on nobody's chart.
 */
export function useChartSelection(args: {
  points: readonly ChartPoint[];
  width: number;
  resetKey: string;
}): ChartInteraction {
  const { points, width, resetKey } = args;

  const [selection, setSelection] = useState<ChartSelection>(IDLE_SELECTION);
  const [lastKey, setLastKey] = useState(resetKey);
  const press = useRef<{ startX: number; moved: boolean } | null>(null);

  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setSelection(IDLE_SELECTION);
    press.current = null;
  }

  const indexAt = useCallback(
    (event: GestureResponderEvent) =>
      nearestPointIndex(points as ChartPoint[], width, event.nativeEvent.locationX),
    [points, width],
  );

  const handlers = useMemo<ChartGestureHandlers>(
    () => ({
      // Claimed on touch-down so the first frame already answers for the
      // point under the finger, and on move so a drag that began as a
      // scroll can still become a scrub.
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      onResponderGrant: (event) => {
        press.current = { startX: event.nativeEvent.locationX, moved: false };
        setSelection((current) => beginScrub(current, indexAt(event)));
      },
      onResponderMove: (event) => {
        const current = press.current;
        if (current === null) return;
        // Latched: a drag that wanders out and back is still a drag. Only
        // a press that never left the ~6px window counts as a tap
        // (behaviour.md § Chart).
        if (!current.moved && isDrag(current.startX, event.nativeEvent.locationX)) {
          current.moved = true;
        }
        const index = indexAt(event);
        setSelection((selected) => moveScrub(selected, index));
      },
      onResponderRelease: (event) => {
        const moved = press.current?.moved ?? true;
        const index = indexAt(event);
        press.current = null;
        setSelection((current) => endGesture(current, { index, moved }));
      },
      onResponderTerminate: () => {
        press.current = null;
        setSelection(cancelScrub);
      },
    }),
    [indexAt],
  );

  return { selection, hint: chartHint(selection), handlers };
}
