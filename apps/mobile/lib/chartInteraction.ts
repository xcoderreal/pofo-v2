/**
 * The chart's scrub / pin / compare state machine, as pure functions.
 *
 * Zero React imports by design (see CLAUDE.md). Three interaction modes
 * come out of *one* pointer gesture (behaviour.md § Chart) — drag to
 * scrub, tap to pin, tap again elsewhere to compare — so "which sequence
 * of presses reaches which mode?" is the part worth pinning down, and it
 * is answerable by `bun test` rather than by dragging a rendered chart.
 *
 * The selection is two orthogonal things rather than one enum, which is
 * what the prototype does and it is right: scrubbing *overlays* a pinned
 * state instead of replacing it, so dragging across a chart with a pin on
 * it and letting go returns to the pin rather than losing it. `chartMode`
 * collapses the pair into the mode actually on screen, in the precedence
 * scrub → compare → pinned → idle.
 */

/**
 * What the chart has selected.
 *
 * Indices into the current points array. They are only meaningful against
 * the series they were taken from, which is why every input that can
 * change that series clears them — see `selectionResetKey`.
 */
export interface ChartSelection {
  /** The point under the pointer *during* a press, or null. Transient:
   * cleared on release, whatever the release turns out to mean. */
  scrubIndex: number | null;
  /** The first pinned point. */
  pinA: number | null;
  /** The second pinned point, which only exists alongside `pinA`. */
  pinB: number | null;
}

export const IDLE_SELECTION: ChartSelection = {
  scrubIndex: null,
  pinA: null,
  pinB: null,
};

export type ChartMode = "idle" | "scrub" | "compare" | "pinned";

/**
 * Which mode the readout and the hint should describe.
 *
 * Scrub wins over the pins because it is happening *now* — a finger on
 * the chart is a question about the point under it, not about the pin it
 * happens to be passing over.
 */
export function chartMode(selection: ChartSelection): ChartMode {
  if (selection.scrubIndex !== null) return "scrub";
  if (selection.pinA !== null && selection.pinB !== null) return "compare";
  if (selection.pinA !== null) return "pinned";
  return "idle";
}

// ─── Tap vs. drag ─────────────────────────────────────────────

/**
 * How far a press may travel and still count as a tap, in logical pixels
 * (behaviour.md § Chart: "a press that moved less than ~6px").
 *
 * A threshold rather than an equality test because no real touch is
 * stationary: a finger on glass moves two or three pixels between down
 * and up, and without slack every pin would register as a one-frame
 * scrub instead.
 */
export const TAP_SLOP_PX = 6;

/** Whether a press that started at `startX` and is now at `x` has become
 * a drag. Horizontal only — the chart's whole axis is horizontal, and a
 * vertical wander during a pin is not the user changing their mind. */
export function isDrag(startX: number, x: number): boolean {
  return Math.abs(x - startX) > TAP_SLOP_PX;
}

// ─── Transitions ──────────────────────────────────────────────

/** Press down: the point under the pointer is shown immediately, so the
 * readout answers before the gesture has decided what it is. */
export function beginScrub(
  selection: ChartSelection,
  index: number | null,
): ChartSelection {
  return { ...selection, scrubIndex: index };
}

/** Pointer moved while down. Identical to `beginScrub` today, and kept
 * separate because the two are separate events with separate meanings —
 * folding them would make the handler read as if a move could start one. */
export function moveScrub(
  selection: ChartSelection,
  index: number | null,
): ChartSelection {
  return { ...selection, scrubIndex: index };
}

/** The gesture was taken away — a parent scroll view claimed it, or the
 * pointer left the chart. Drops the scrub, keeps the pins. */
export function cancelScrub(selection: ChartSelection): ChartSelection {
  return { ...selection, scrubIndex: null };
}

/**
 * Release.
 *
 * A press that travelled is a scrub and ends with nothing new selected. A
 * press that stayed put is a tap, and a tap means one of three things:
 *
 * - on the single pinned point → clear it (behaviour.md § Chart);
 * - with exactly one pin, on a *different* point → that becomes B and the
 *   band between them is shaded;
 * - anything else — nothing pinned, or already comparing → pin here,
 *   alone. Tapping during a compare therefore starts a fresh pair from
 *   the point tapped rather than doing nothing.
 */
export function endGesture(
  selection: ChartSelection,
  args: { index: number | null; moved: boolean },
): ChartSelection {
  const { index, moved } = args;
  if (moved || index === null) {
    return { ...selection, scrubIndex: null };
  }

  const { pinA, pinB } = selection;
  if (pinA !== null && pinB === null) {
    return index === pinA
      ? IDLE_SELECTION
      : { scrubIndex: null, pinA, pinB: index };
  }
  return { scrubIndex: null, pinA: index, pinB: null };
}

/**
 * Drop indices the current series can no longer answer for.
 *
 * Every deliberate change of series clears the selection outright, but a
 * refetch is not deliberate: prices arriving, or a background refresh
 * returning one bucket fewer, can shrink the array under a live pin. An
 * index past the end would read `undefined` and render `$NaN`, so it is
 * dropped instead — and dropping B alone leaves a legitimate pinned
 * state rather than collapsing the whole thing.
 */
export function clampSelection(
  selection: ChartSelection,
  pointCount: number,
): ChartSelection {
  const keep = (index: number | null) =>
    index !== null && index >= 0 && index < pointCount ? index : null;
  const pinA = keep(selection.pinA);
  const pinB = keep(selection.pinB);
  return {
    scrubIndex: keep(selection.scrubIndex),
    // B without A is not a state the machine has — a lone second pin
    // would read as a compare against nothing.
    pinA: pinA ?? pinB,
    pinB: pinA === null ? null : pinB,
  };
}

// ─── What clears a selection ──────────────────────────────────

/**
 * The inputs a selection is only valid against.
 *
 * "Changing range, granularity, metric or scope clears pins"
 * (behaviour.md § Chart) — expressed as a key so the rule lives in one
 * tested function instead of being repeated as a `clear()` call in the
 * eight handlers that can change any of them, one of which would
 * eventually be forgotten.
 *
 * `cumulative` is in it because it re-queries the same metric in a
 * different mode, so index 3 stops meaning what it meant — the prototype
 * clears pins from its Per period / Cumulative toggle for exactly that
 * reason. `tab` is deliberately *not*: switching Holdings ↔ Accounts
 * changes the list below the chart and leaves the chart alone.
 */
export interface SelectionInputs {
  metric: string;
  rangeKey: string;
  granularity: string | null;
  customRange: { start: string; end: string } | null;
  cumulative: boolean;
  instrumentId: string | null;
  accountId: string | null;
}

export function selectionResetKey(state: SelectionInputs): string {
  return [
    state.metric,
    state.rangeKey,
    state.granularity ?? "auto",
    state.customRange ? `${state.customRange.start}..${state.customRange.end}` : "-",
    state.cumulative ? "cum" : "per",
    state.instrumentId ?? "-",
    state.accountId ?? "-",
  ].join("|");
}

// ─── Hint ─────────────────────────────────────────────────────

/**
 * The line under the chart, which says what the *current* gesture state
 * can do next rather than repeating one static instruction
 * (behaviour.md § Chart, and #15's acceptance criteria).
 *
 * Copy is directional (behaviour.md preamble); the mode it keys on is not.
 */
export function chartHint(selection: ChartSelection): string {
  switch (chartMode(selection)) {
    case "scrub":
      return "Scrubbing · release to pin this point";
    case "compare":
      return "A → B compare · tap a point to start over";
    case "pinned":
      return "Pinned · tap another point to compare";
    case "idle":
      return "Drag the chart to scrub · tap to pin";
  }
}
