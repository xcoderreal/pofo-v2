import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";

/** Placeholder until #20 builds the total tile, allocation bar,
 * instrument × account matrix and account list. */
export default function GridScreen() {
  const theme = useTheme();

  return (
    <View
      testID="grid-screen"
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
    >
      <Text style={[styles.text, { color: theme.colors.textSecondary }]}>
        Grid arrives in #20
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 14 },
});
