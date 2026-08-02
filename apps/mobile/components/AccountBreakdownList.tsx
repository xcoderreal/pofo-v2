import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { changeColor, ListRow, SectionTitle } from "@/components/ListRow";
import { useTheme } from "@/hooks/useTheme";
import { formatPercent, formatShares, formatSigned, formatUsd } from "@/lib/format";
import type { InstrumentAccountRow } from "@/lib/positions";

interface Props {
  /** "Across your accounts" at instrument level; at slice level the same
   * list, already narrowed to the one account. */
  title: string;
  rows: InstrumentAccountRow[];
  /** Accounts that once held this instrument and no longer do. Same
   * disclosure treatment as the Holdings list's closed positions. */
  closedRows: InstrumentAccountRow[];
  onSelectAccount: (accountId: string) => void;
  isPending: boolean;
  errorMessage?: string | null;
  emptyMessage: string;
}

/**
 * One row per Account holding the selected Instrument — the list that
 * makes instrument level a *level* rather than a filtered portfolio view,
 * and the last step down to a slice.
 *
 * Separate from `PositionsList` rather than another branch inside it:
 * the two answer different questions ("what do I hold" vs "where do I
 * hold it"), have different row contents, and neither has tabs in common
 * with the other. They share `ListRow`, which is the part that must look
 * identical.
 */
export function AccountBreakdownList({
  title,
  rows,
  closedRows,
  onSelectAccount,
  isPending,
  errorMessage,
  emptyMessage,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [showClosed, setShowClosed] = useState(false);

  return (
    <View testID="breakdown-list" style={styles.container}>
      <SectionTitle>{title}</SectionTitle>

      {errorMessage ? (
        <Text testID="positions-error" style={styles.error}>
          {errorMessage}
        </Text>
      ) : isPending ? (
        <View testID="positions-loading" style={styles.pending}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <>
          {rows.length === 0 && closedRows.length === 0 ? (
            <Text testID="positions-empty" style={styles.empty}>
              {emptyMessage}
            </Text>
          ) : null}

          {rows.map((row) => (
            <ListRow
              key={row.accountId}
              testID={`breakdown-row-${row.accountId}`}
              title={row.name}
              subtitle={
                row.averageCost === null
                  ? row.accountType
                  : `${formatShares(row.shareCount)} · avg ${formatUsd(row.averageCost)}`
              }
              value={row.marketValue === null ? "—" : formatUsd(row.marketValue)}
              valueTestID={`breakdown-value-${row.accountId}`}
              detail={formatPercent(row.changePercent)}
              detailTestID={`breakdown-percent-${row.accountId}`}
              detailColor={changeColor(row.changePercent, theme)}
              onPress={() => onSelectAccount(row.accountId)}
            />
          ))}

          {closedRows.length > 0 ? (
            <>
              <Pressable
                testID="closed-toggle"
                accessibilityState={{ expanded: showClosed }}
                onPress={() => setShowClosed((open) => !open)}
                style={styles.disclosure}
              >
                <Text style={styles.disclosureLabel}>
                  Closed here · {closedRows.length}
                </Text>
                <Text style={styles.disclosureAction}>
                  {showClosed ? "Hide" : "Show"}
                </Text>
              </Pressable>

              {showClosed
                ? closedRows.map((row) => (
                    <ListRow
                      key={row.accountId}
                      testID={`breakdown-closed-row-${row.accountId}`}
                      title={row.name}
                      subtitle="closed"
                      value="—"
                      valueTestID={`breakdown-closed-value-${row.accountId}`}
                      detail={`realized ${formatSigned(row.realizedGain)}`}
                      detailTestID={`breakdown-closed-realized-${row.accountId}`}
                      detailColor={changeColor(row.realizedGain, theme)}
                      onPress={() => onSelectAccount(row.accountId)}
                    />
                  ))
                : null}
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: { marginTop: theme.spacing.xl },
    disclosure: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    disclosureLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
    },
    disclosureAction: {
      color: theme.colors.primary,
      fontSize: theme.fontSize.md,
      fontWeight: "500",
    },
    pending: { paddingVertical: theme.spacing.xl, alignItems: "center" },
    error: {
      color: theme.colors.danger,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
    },
    empty: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
    },
  });
}
