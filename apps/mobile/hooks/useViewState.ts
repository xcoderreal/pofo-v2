import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_VIEW_STATE,
  resolveLevel,
  type Level,
  type ViewState,
} from "@/lib/drilldown";

/** How long the Undo toast stays up, per
 * docs/design/dashboard_v2/behaviour.md § Undo toast. */
export const UNDO_TIMEOUT_MS = 5000;

export interface UndoToast {
  message: string;
  /** The *entire* view state as it was before the change — not just the
   * chip that went away. */
  snapshot: ViewState;
}

export interface ViewStateController {
  state: ViewState;
  level: Level;
  toast: UndoToast | null;
  /** An ordinary change: no snapshot, no toast. */
  update: (next: ViewState) => void;
  /**
   * A change the user did not ask for, or asked for destructively:
   * snapshots everything first and offers it back for five seconds.
   */
  updateWithUndo: (message: string, next: ViewState) => void;
  undo: () => void;
  dismissToast: () => void;
}

/**
 * The Portfolio tab's view state, plus the Undo machinery that guards
 * every filter-clearing change.
 *
 * Two update paths rather than one, because the distinction is the whole
 * feature: drilling *in* is something the user just did and can see, so
 * it needs no safety net, while clearing a chip discards a scope — and,
 * once #18 lands, may clear a chip the user never touched as a side
 * effect of picking a metric. Those get the toast.
 *
 * The snapshot is the whole `ViewState` deliberately. Restoring only the
 * dismissed chip would leave behind whatever an auto-adjustment silently
 * changed on the way in — you would undo your way back to a slice that is
 * now showing a different metric than the one you left.
 */
export function useViewState(
  initial: ViewState = INITIAL_VIEW_STATE,
): ViewStateController {
  const [state, setState] = useState<ViewState>(initial);
  const [toast, setToast] = useState<UndoToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A pending timer outliving the screen would call setState on an
  // unmounted component; navigating to Grid mid-toast is enough to hit it.
  useEffect(() => clearTimer, [clearTimer]);

  const update = useCallback((next: ViewState) => setState(next), []);

  const updateWithUndo = useCallback(
    (message: string, next: ViewState) => {
      setToast({ message, snapshot: state });
      setState(next);
      // A second clear restarts the five seconds rather than inheriting
      // the remainder of the first — the newest toast is the one being
      // offered, so it gets a full window.
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        setToast(null);
      }, UNDO_TIMEOUT_MS);
    },
    [clearTimer, state],
  );

  const undo = useCallback(() => {
    clearTimer();
    if (toast !== null) setState(toast.snapshot);
    setToast(null);
  }, [clearTimer, toast]);

  const dismissToast = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  return {
    state,
    level: resolveLevel(state),
    toast,
    update,
    updateWithUndo,
    undo,
    dismissToast,
  };
}
