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
          <Stack.Screen name="index" options={{ title: "Items" }} />
          <Stack.Screen
            name="items/[id]/index"
            options={{ title: "Item Detail" }}
          />
          <Stack.Screen name="items/new" options={{ title: "New Item" }} />
          <Stack.Screen name="categories" options={{ title: "Categories" }} />
        </Stack>
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
