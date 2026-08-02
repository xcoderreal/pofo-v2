import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ScopeChip } from "@/lib/drilldown";

interface Props {
  chips: ScopeChip[];
  onClear: (kind: ScopeChip["kind"]) => void;
}

/**
 * The active instrument/account filters, as dismissible chips.
 *
 * These are the only thing on screen that says *why* the chart and lists
 * are narrowed, and the only control that widens them again — so a scope
 * without a chip would be a trap. Dismissing one steps back to the
 * broader level and raises the Undo toast
 * (docs/design/dashboard_v2/behaviour.md § Undo toast).
 */
export function ScopeChips({ chips, onClear }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (chips.length === 0) return null;

  return (
    <View testID="scope-chips" style={styles.row}>
      {chips.map((chip) => (
        <View key={chip.kind} testID={`chip-${chip.kind}`} style={styles.chip}>
          <Text style={styles.kind}>
            {chip.kind === "instrument" ? "Instrument" : "Account"}
          </Text>
          <Text style={styles.label} numberOfLines={1}>
            {chip.label}
          </Text>
          <Pressable
            testID={`chip-${chip.kind}-clear`}
            accessibilityLabel={`Clear ${chip.kind} filter`}
            hitSlop={8}
            onPress={() => onClear(chip.kind)}
          >
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.sm,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    kind: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
    },
    label: {
      color: theme.colors.text,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
    },
    clear: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.sm,
      paddingHorizontal: 2,
    },
  });
}
