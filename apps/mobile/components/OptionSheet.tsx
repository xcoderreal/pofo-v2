import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/BottomSheet";
import { useTheme } from "@/hooks/useTheme";

export interface SheetOption {
  key: string;
  label: string;
  /** The short note under the label. For a disabled option this is where
   * the reason lives, inline — a greyed row with no explanation is the
   * failure mode this sheet exists to avoid. */
  note: string;
  selected: boolean;
  disabled?: boolean;
}

interface Props {
  testID: string;
  title: string;
  subtitle: string;
  options: SheetOption[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

/**
 * A bottom sheet of mutually-exclusive options — Metric, Granularity and
 * Accounts are all this shape.
 *
 * Disabled rows stay rendered and stay readable rather than disappearing:
 * "Market price isn't in the list" and "Market price needs an instrument"
 * are different messages, and only the second one teaches the rule
 * (docs/adr/0001-dashboard-v2.md § 6).
 */
export function OptionSheet({
  testID,
  title,
  subtitle,
  options,
  onSelect,
  onClose,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <BottomSheet
      testID={testID}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
    >
      {options.map((option) => (
        <Pressable
          key={option.key}
          testID={`${testID}-option-${option.key}`}
          accessibilityState={{
            selected: option.selected,
            disabled: option.disabled === true,
          }}
          disabled={option.disabled === true}
          onPress={() => onSelect(option.key)}
          style={[styles.row, option.disabled === true && styles.rowDisabled]}
        >
          <View
            testID={
              option.selected ? `${testID}-selected-${option.key}` : undefined
            }
            style={[styles.dot, option.selected && styles.dotSelected]}
          />
          <View style={styles.labels}>
            <Text style={styles.label}>{option.label}</Text>
            <Text testID={`${testID}-note-${option.key}`} style={styles.note}>
              {option.note}
            </Text>
          </View>
        </Pressable>
      ))}
    </BottomSheet>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    rowDisabled: { opacity: 0.38 },
    dot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
    },
    dotSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    labels: { flex: 1 },
    label: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      fontWeight: "500",
    },
    note: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      marginTop: 2,
    },
  });
}
