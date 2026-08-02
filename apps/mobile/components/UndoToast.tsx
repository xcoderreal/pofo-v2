import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}

/**
 * The five-second Undo offered after a filter is cleared.
 *
 * The timer and the state snapshot live in `useViewState`, not here — the
 * toast is a rendering of an offer, and the offer has to survive whatever
 * this component does. Undo restores the *entire* prior view state, not
 * just the chip that went away (docs/design/dashboard_v2/behaviour.md
 * § Undo toast), which is what makes it safe for #18's auto-clears too:
 * those change the metric and the scope in one step.
 */
export function UndoToast({ message, onUndo, onDismiss }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View testID="undo-toast" style={styles.toast} pointerEvents="box-none">
      <Text testID="undo-toast-message" style={styles.message} numberOfLines={2}>
        {message}
      </Text>
      <Pressable testID="undo-toast-action" hitSlop={8} onPress={onUndo}>
        <Text style={styles.undo}>Undo</Text>
      </Pressable>
      <Pressable
        testID="undo-toast-dismiss"
        accessibilityLabel="Dismiss"
        hitSlop={8}
        onPress={onDismiss}
      >
        <Text style={styles.dismiss}>✕</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    toast: {
      position: "absolute",
      left: theme.spacing.lg,
      right: theme.spacing.lg,
      bottom: theme.spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    message: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
    },
    undo: {
      color: theme.colors.primary,
      fontSize: theme.fontSize.md,
      fontWeight: "600",
    },
    dismiss: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
    },
  });
}
