import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import { ThemeContext } from "@/hooks/useTheme";
import { darkTheme } from "@/utils/theme";

const queryClient = new QueryClient();

export default function RootLayout() {
  const theme = darkTheme;

  return (
    <ThemeContext.Provider value={theme}>
      <QueryClientProvider client={queryClient}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.textTertiary,
            tabBarStyle: {
              backgroundColor: theme.colors.background,
              borderTopColor: theme.colors.borderLight,
            },
            sceneStyle: { backgroundColor: theme.colors.background },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{ title: "Portfolio", tabBarButtonTestID: "nav-portfolio" }}
          />
          <Tabs.Screen
            name="grid"
            options={{ title: "Grid", tabBarButtonTestID: "nav-grid" }}
          />
          <Tabs.Screen
            name="activity"
            options={{ title: "Activity", tabBarButtonTestID: "nav-activity" }}
          />
        </Tabs>
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
