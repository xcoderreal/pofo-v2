import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { AllocationSegment } from "@/lib/grid";
import { allocationColors } from "@/utils/theme";

interface Props {
  segments: AllocationSegment[];
  onSelectAccount: (accountId: string) => void;
}

/**
 * Where the money sits, as one bar by account.
 *
 * The bar and its legend are the same list rendered twice, so a segment
 * too thin to tap is still reachable from the legend below — with no cap
 * on the number of accounts (behaviour.md § Grid), thin segments are the
 * expected case rather than the edge one. Both routes drill into the
 * account.
 *
 * Widths are `flexGrow` on the percentage rather than a percentage width,
 * so the segments always fill the bar exactly however the rounding falls.
 */
export function AllocationBar({ segments, onSelectAccount }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (segments.length === 0) {
    return (
      <Text testID="allocation-empty" style={styles.empty}>
        Nothing allocated yet.
      </Text>
    );
  }

  return (
    <View testID="allocation-bar">
      <View style={styles.bar}>
        {segments.map((segment, index) => (
          <Pressable
            key={segment.accountId}
            testID={`allocation-segment-${segment.accountId}`}
            accessibilityRole="button"
            accessibilityLabel={`${segment.label}, ${segment.percent.toFixed(0)}%`}
            onPress={() => onSelectAccount(segment.accountId)}
            style={[
              styles.segment,
              {
                flexGrow: segment.percent,
                backgroundColor: colorFor(index),
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.legend}>
        {segments.map((segment, index) => (
          <Pressable
            key={segment.accountId}
            testID={`allocation-legend-${segment.accountId}`}
            accessibilityRole="button"
            onPress={() => onSelectAccount(segment.accountId)}
            style={styles.legendItem}
          >
            <View style={[styles.dot, { backgroundColor: colorFor(index) }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {segment.label}
            </Text>
            <Text
              testID={`allocation-percent-${segment.accountId}`}
              style={styles.legendPercent}
            >
              {segment.percent.toFixed(0)}%
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function colorFor(index: number): string {
  return allocationColors[index % allocationColors.length];
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      height: 12,
      borderRadius: 999,
      overflow: "hidden",
      gap: 2,
      marginHorizontal: theme.spacing.lg,
    },
    // `flexBasis: 0` so the whole width is distributed by `flexGrow`
    // alone — a default basis would give every segment a minimum share
    // and flatten the difference between a 60% account and a 2% one.
    segment: { flexBasis: 0, height: "100%" },
    legend: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.md,
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.xs,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.sm,
      maxWidth: 130,
    },
    legendPercent: {
      color: theme.colors.text,
      fontSize: theme.fontSize.sm,
      fontWeight: "600",
    },
    empty: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
    },
  });
}
