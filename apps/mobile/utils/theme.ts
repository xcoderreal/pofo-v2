export const lightTheme = {
  colors: {
    background: "#ffffff",
    surface: "#f9f9f9",
    text: "#000000",
    textSecondary: "#666666",
    textTertiary: "#999999",
    placeholder: "#aaaaaa",
    primary: "#4a90d9",
    primaryText: "#ffffff",
    border: "#dddddd",
    borderLight: "#eeeeee",
    danger: "#d94a4a",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  fontSize: {
    xs: 12,
    sm: 13,
    md: 14,
    lg: 16,
    xl: 18,
  },
  borderRadius: {
    sm: 4,
    md: 6,
    lg: 8,
  },
};

/**
 * The dashboard's palette. Dark is the design's native mode — the chart,
 * the accent-on-near-black value treatment and the muted chrome are all
 * built around it (docs/design/dashboard_v2). `lightTheme` is kept
 * because the scaffold screens still reference it and a future
 * ThemeProvider swap is a stated goal (CLAUDE.md).
 */
export const darkTheme: Theme = {
  colors: {
    background: "#0A0B0D",
    surface: "#12151A",
    text: "#F2F4F7",
    textSecondary: "#8A9099",
    textTertiary: "#6C737D",
    placeholder: "#5A616B",
    primary: "#7EE2A8",
    primaryText: "#0A0B0D",
    border: "#232830",
    borderLight: "#1A1E24",
    danger: "#E8705F",
  },
  spacing: lightTheme.spacing,
  fontSize: lightTheme.fontSize,
  borderRadius: lightTheme.borderRadius,
};

/** Semantic colours for gain/loss, which are not part of the neutral
 * palette — they carry meaning, so they are named for it. */
export const signalColors = {
  up: "#7EE2A8",
  down: "#E8705F",
  flat: "#8A9099",
};

export type Theme = typeof lightTheme;
