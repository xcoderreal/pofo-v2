import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";

/** Placeholder until #21 builds the month-grouped ledger. */
export default function ActivityScreen() {
  const theme = useTheme();

  return (
    <View
      testID="activity-screen"
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
    >
      <Text style={[styles.text, { color: theme.colors.textSecondary }]}>
        Activity arrives in #21
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 14 },
});
