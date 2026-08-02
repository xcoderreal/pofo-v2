import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ScopeChip } from "@/lib/drilldown";

interface Props {
  chips: ScopeChip[];
  onClear: (kind: ScopeChip["kind"]) => void;
  /**
   * Opens the Accounts sheet. The account chip is both the indicator and
   * the control: tapping its body switches account, tapping its ✕ clears
   * the filter entirely.
   *
   * Omitted on the Activity tab, which has no Accounts sheet of its own —
   * the chips there report and dismiss the shared scope, nothing more. The
   * "All accounts" button then isn't rendered at all rather than rendered
   * inert, same reasoning as `ListRow`'s optional `onPress`.
   */
  onOpenAccounts?: () => void;
}

/**
 * The active instrument/account filters, as dismissible chips.
 *
 * These are the only thing on screen that says *why* the chart and lists
 * are narrowed, and the only control that widens them again — so a scope
 * without a chip would be a trap. Dismissing one steps back to the
 * broader level and raises the Undo toast
 * (docs/design/dashboard_v2/behaviour.md § Undo toast).
 *
 * With no account selected the row carries an "All accounts" button in the
 * chip's place, which is the prototype's own entry point to the Accounts
 * sheet — generalised from "only when the row is otherwise empty" to
 * "whenever no account is chosen", so the sheet stays reachable from
 * instrument level too.
 */
export function ScopeChips({ chips, onClear, onOpenAccounts }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const hasAccount = chips.some((chip) => chip.kind === "account");

  return (
    <View testID="scope-chips" style={styles.row}>
      {chips.map((chip) => (
        <View key={chip.kind} testID={`chip-${chip.kind}`} style={styles.chip}>
          <Pressable
            testID={`chip-${chip.kind}-open`}
            disabled={chip.kind !== "account" || onOpenAccounts === undefined}
            onPress={onOpenAccounts}
            style={styles.chipBody}
          >
            <Text style={styles.kind}>
              {chip.kind === "instrument" ? "Instrument" : "Account"}
            </Text>
            <Text style={styles.label} numberOfLines={1}>
              {chip.label}
            </Text>
          </Pressable>
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

      {hasAccount || onOpenAccounts === undefined ? null : (
        <Pressable
          testID="all-accounts-chip"
          onPress={onOpenAccounts}
          style={styles.chip}
        >
          <Text style={styles.label}>All accounts</Text>
          <Text style={styles.clear}>⌄</Text>
        </Pressable>
      )}
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
    chipBody: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.xs,
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
