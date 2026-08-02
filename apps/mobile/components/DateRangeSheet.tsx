import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/BottomSheet";
import { useTheme } from "@/hooks/useTheme";
import { parseCustomRange } from "@/lib/timeseries";

interface Props {
  /** The bounds already in effect, if the range is already Custom. */
  initial: { start: string; end: string } | null;
  onApply: (range: { start: string; end: string }) => void;
  onClose: () => void;
}

/**
 * The Custom range sheet: two dates, applied as the chart's bounds.
 *
 * Typed rather than picked. A calendar widget is a native dependency this
 * app doesn't have and would have to render in a browser too, whereas
 * `YYYY-MM-DD` is unambiguous, matches what the API takes, and is the same
 * on both platforms. Validation is `parseCustomRange`, so the rules are
 * unit-tested and this component only renders the verdict.
 */
export function DateRangeSheet({ initial, onApply, onClose }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [start, setStart] = useState(initial?.start ?? "");
  const [end, setEnd] = useState(initial?.end ?? "");

  const result = parseCustomRange(start, end);

  return (
    <BottomSheet
      testID="custom-sheet"
      title="Custom range"
      subtitle="Chart and lists both follow these bounds. Granularity re-picks itself for the span."
      onClose={onClose}
    >
      <View style={styles.fields}>
        <Field
          label="From"
          testID="custom-start"
          value={start}
          onChange={setStart}
          styles={styles}
          theme={theme}
        />
        <Field
          label="To"
          testID="custom-end"
          value={end}
          onChange={setEnd}
          styles={styles}
          theme={theme}
        />
      </View>

      <Text testID="custom-status" style={styles.status}>
        {result.ok
          ? `${result.start} → ${result.end}`
          : result.reason}
      </Text>

      <Pressable
        testID="custom-apply"
        accessibilityState={{ disabled: !result.ok }}
        disabled={!result.ok}
        onPress={() => {
          if (result.ok) onApply({ start: result.start, end: result.end });
        }}
        style={[styles.apply, !result.ok && styles.applyDisabled]}
      >
        <Text style={styles.applyText}>Apply range</Text>
      </Pressable>
    </BottomSheet>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Field({
  label,
  testID,
  value,
  onChange,
  styles,
  theme,
}: {
  label: string;
  testID: string;
  value: string;
  onChange: (next: string) => void;
  styles: Styles;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    fields: {
      flexDirection: "row",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
    },
    field: { flex: 1, gap: theme.spacing.xs },
    fieldLabel: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
    },
    input: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    status: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
    },
    apply: {
      margin: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
      alignItems: "center",
      backgroundColor: theme.colors.primary,
    },
    applyDisabled: { opacity: 0.38 },
    applyText: {
      color: theme.colors.primaryText,
      fontSize: theme.fontSize.lg,
      fontWeight: "600",
    },
  });
}
