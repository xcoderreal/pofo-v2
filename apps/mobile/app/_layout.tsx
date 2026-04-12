import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { ThemeContext } from "@/hooks/useTheme";
import { lightTheme } from "@/utils/theme";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <ThemeContext.Provider value={lightTheme}>
      <QueryClientProvider client={queryClient}>
        <Stack>
          <Stack.Screen name="index" options={{ title: "Portfolio" }} />
          <Stack.Screen name="accounts" options={{ title: "Accounts" }} />
          <Stack.Screen name="instruments" options={{ title: "Instruments" }} />
          <Stack.Screen
            name="transactions/new"
            options={{ title: "Log Trade" }}
          />
          <Stack.Screen
            name="portfolio/[slug]"
            options={{ title: "Detail" }}
          />
        </Stack>
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
