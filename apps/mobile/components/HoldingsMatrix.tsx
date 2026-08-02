import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { formatCompactUsd } from "@/lib/format";
import type { Matrix } from "@/lib/grid";

interface Props {
  matrix: Matrix;
  /** A cell — that instrument in that account, i.e. a slice. */
  onSelectCell: (instrumentId: string, accountId: string) => void;
  /** A row header — that instrument across every account. */
  onSelectInstrument: (instrumentId: string) => void;
  /** A column header — that account across every instrument. */
  onSelectAccount: (accountId: string) => void;
}

const SYMBOL_WIDTH = 76;
const CELL_WIDTH = 104;
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 34;
/** Roughly seven rows. Past that the table scrolls rather than pushing
 * the account list off the bottom of a portfolio-sized screen. */
const BODY_MAX_HEIGHT = HEADER_HEIGHT + ROW_HEIGHT * 7;

/**
 * Instruments down, accounts across, slice value in each cell.
 *
 * **Nothing is truncated.** Every instrument with a live position is a
 * row and every account holding one is a column (behaviour.md § Grid),
 * so the table's size is the portfolio's, not a constant — the prototype's
 * 7 × 4 cap is gone. What replaces it is scrolling on both axes, with the
 * symbol column outside the horizontal scroller so a row stays
 * identifiable however far across you are.
 *
 * The column headers sit *inside* the vertical scroll rather than pinned
 * to it. Pinning them too would mean a second horizontal scroller kept in
 * sync with the first by hand — measurable jank for a header that is one
 * flick away, on a table whose rows are already labelled.
 *
 * Cells with no holding are dots and render as plain `View`s: there is no
 * slice behind them, and a pressable that opens an empty screen is worse
 * than one that does not respond.
 */
export function HoldingsMatrix({
  matrix,
  onSelectCell,
  onSelectInstrument,
  onSelectAccount,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (matrix.rows.length === 0) {
    return (
      <Text testID="matrix-empty" style={styles.empty}>
        No open positions to lay out yet.
      </Text>
    );
  }

  return (
    <ScrollView
      testID="matrix-vscroll"
      style={[styles.vscroll, { maxHeight: BODY_MAX_HEIGHT }]}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.table}>
        {/* Pinned: a sibling of the horizontal scroller, not a child. */}
        <View testID="matrix-symbol-column" style={styles.symbolColumn}>
          <View style={[styles.corner, { height: HEADER_HEIGHT }]} />
          {matrix.rows.map((row) => (
            <Pressable
              key={row.instrumentId}
              testID={`matrix-row-${row.instrumentId}`}
              accessibilityRole="button"
              onPress={() => onSelectInstrument(row.instrumentId)}
              style={styles.symbolCell}
            >
              <Text style={styles.symbolText} numberOfLines={1}>
                {row.symbol}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView
          testID="matrix-hscroll"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <View>
            <View style={[styles.headerRow, { height: HEADER_HEIGHT }]}>
              {matrix.columns.map((column) => (
                <Pressable
                  key={column.accountId}
                  testID={`matrix-column-${column.accountId}`}
                  accessibilityRole="button"
                  onPress={() => onSelectAccount(column.accountId)}
                  style={styles.headerCell}
                >
                  <Text style={styles.headerText} numberOfLines={1}>
                    {column.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {matrix.rows.map((row) => (
              <View key={row.instrumentId} style={styles.cellRow}>
                {row.cells.map((cell) =>
                  cell.held ? (
                    <Pressable
                      key={cell.accountId}
                      testID={`matrix-cell-${row.instrumentId}-${cell.accountId}`}
                      accessibilityRole="button"
                      onPress={() =>
                        onSelectCell(row.instrumentId, cell.accountId)
                      }
                      style={[styles.cell, styles.cellHeld]}
                    >
                      <Text style={styles.cellText}>
                        {/* Held but unpriced is a dash, not a dot: the
                            position is real, only its value is missing. */}
                        {cell.value === null
                          ? "—"
                          : formatCompactUsd(cell.value)}
                      </Text>
                    </Pressable>
                  ) : (
                    <View
                      key={cell.accountId}
                      testID={`matrix-empty-${row.instrumentId}-${cell.accountId}`}
                      style={[styles.cell, styles.cellEmpty]}
                    >
                      <Text style={styles.cellEmptyText}>·</Text>
                    </View>
                  ),
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    vscroll: { marginTop: theme.spacing.md },
    table: { flexDirection: "row", paddingLeft: theme.spacing.lg },
    symbolColumn: { width: SYMBOL_WIDTH, backgroundColor: theme.colors.background },
    corner: { justifyContent: "center" },
    symbolCell: { height: ROW_HEIGHT, justifyContent: "center" },
    symbolText: {
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
      fontWeight: "600",
    },
    headerRow: { flexDirection: "row" },
    headerCell: {
      width: CELL_WIDTH,
      paddingHorizontal: theme.spacing.xs,
      justifyContent: "center",
    },
    headerText: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      letterSpacing: 0.5,
    },
    cellRow: { flexDirection: "row" },
    cell: {
      width: CELL_WIDTH - 4,
      height: ROW_HEIGHT - 4,
      marginRight: 4,
      marginBottom: 4,
      borderRadius: theme.borderRadius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    cellHeld: { backgroundColor: theme.colors.surface },
    // Distinct from a valued cell by both fill and content — colour alone
    // is not a difference every reader can see.
    cellEmpty: { backgroundColor: "transparent" },
    cellText: {
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
      fontWeight: "500",
    },
    cellEmptyText: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.lg,
    },
    empty: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
    },
  });
}
