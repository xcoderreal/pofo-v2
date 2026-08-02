/**
 * Display formatting for money, percentages and share counts.
 *
 * Zero React imports by design (see CLAUDE.md) — the headline figure and
 * every list row format the same way, so the rules live in one pure,
 * directly-testable place rather than being duplicated per screen.
 */

/** `$1,234.56`, or `$12,345` once the cents stop carrying information. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 10_000 ? 0 : 2;
  return `${value < 0 ? "−" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Always carries an explicit sign — `+$120.00`, `−$3.40`. */
export function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : "−"}${formatUsd(Math.abs(value))}`;
}

/**
 * `+12.34%`, or an em dash when there is no percentage to show.
 *
 * The dash is the whole point: a position that did not exist at the start
 * of the selected range has no denominator, and a fabricated `0.00%`
 * would read as "unchanged" (docs/design/dashboard_v2/behaviour.md
 * § Percentages).
 */
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
}

/** Share counts are fractional for crypto and whole for most equities —
 * trailing zeros on a whole count are noise, so they're dropped. */
export function formatShares(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
