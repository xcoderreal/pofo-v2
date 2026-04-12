import { createContext, useContext } from "react";
import { lightTheme, type Theme } from "@/utils/theme";

export const ThemeContext = createContext<Theme>(lightTheme);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
