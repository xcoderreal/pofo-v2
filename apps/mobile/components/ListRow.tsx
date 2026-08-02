import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { signalColors } from "@/utils/theme";

interface Props {
  testID: string;
  title: string;
  subtitle: string;
  value: string;
  valueTestID: string;
  detail: string;
  detailTestID: string;
  detailColor: string;
  /** Omitted for a row that leads nowhere, which then renders as a plain
   * `View` — a pressable that does nothing is worse than a static row. */
  onPress?: () => void;
}

/**
 * One row of a dashboard list: title/subtitle on the left, a value and a
 * coloured detail on the right.
 *
 * Shared by every list on the Portfolio tab — Holdings, Accounts and the
 * instrument level's "Across your accounts" — because drilling down means
 * the same row shape answers a narrower question, not a different-looking
 * screen (docs/design/dashboard_v2/behaviour.md § Navigation and scope).
 */
export function ListRow({
  testID,
  title,
  subtitle,
  value,
  valueTestID,
  detail,
  detailTestID,
  detailColor,
  onPress,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const Container = onPress ? Pressable : View;

  return (
    <Container testID={testID} onPress={onPress} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.rowValues}>
        <Text testID={valueTestID} style={styles.rowValue}>
          {value}
        </Text>
        <Text
          testID={detailTestID}
          style={[styles.rowDetail, { color: detailColor }]}
        >
          {detail}
        </Text>
      </View>
    </Container>
  );
}

/** The heading a narrowed list carries in place of the portfolio level's
 * Holdings/Accounts tabs. */
export function SectionTitle({ children }: { children: string }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Text testID="section-title" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderLight,
    },
    rowText: { flexShrink: 1 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      fontWeight: "600",
    },
    rowSubtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.sm,
      marginTop: 2,
    },
    rowValues: { alignItems: "flex-end" },
    rowValue: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      fontWeight: "500",
    },
    rowDetail: { fontSize: theme.fontSize.sm, marginTop: 2 },
    sectionTitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      letterSpacing: 1,
      textTransform: "uppercase",
      paddingHorizontal: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
  });
}

/** Gain/loss colouring shared by every list's detail column. A null —
 * the range has no denominator — is neither up nor down. */
export function changeColor(
  value: number | null,
  theme: ReturnType<typeof useTheme>,
): string {
  if (value === null) return theme.colors.textTertiary;
  return value >= 0 ? signalColors.up : signalColors.down;
}
