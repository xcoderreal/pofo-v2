import { useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  onPress: () => void;
}

/**
 * The floating action button that opens the transaction entry sheet.
 *
 * Rendered by the Portfolio and Activity tabs, not by the layout, because
 * it is deliberately absent from the Grid (#22 AC 1). The Grid is a fixed
 * whole-portfolio cross-section that carries no scope of its own — a tap
 * there *sets* a scope and hands you to the Portfolio tab — so a sheet
 * opened from it could only ever be the "nothing prefilled" state, which
 * is the state the sheet warns about rather than a destination. The
 * prototype hides it there too (`fabDisp`).
 *
 * Absolutely positioned inside the screen's own root view, the same as
 * `UndoToast` and `BottomSheet`: one render tree per screen, and the
 * sheet — rendered after this — covers it rather than fighting a portal.
 */
export function EntryFab({ onPress }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <Pressable
      testID="entry-fab"
      accessibilityRole="button"
      accessibilityLabel="Record a transaction"
      onPress={onPress}
      style={styles.fab}
    >
      <Text style={styles.plus}>+</Text>
    </Pressable>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    fab: {
      position: "absolute",
      right: theme.spacing.lg,
      bottom: theme.spacing.xl,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.primary,
    },
    plus: {
      color: theme.colors.primaryText,
      fontSize: 30,
      lineHeight: 34,
      fontWeight: "600",
    },
  });
}
