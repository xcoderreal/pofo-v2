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

export type Theme = typeof lightTheme;
