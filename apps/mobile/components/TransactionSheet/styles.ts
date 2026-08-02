import { StyleSheet } from "react-native";
import type { Theme } from "@/utils/theme";

/** Split out of `index.tsx` only for length (CLAUDE.md § "promote at 300
 * lines"). Nothing here is shared with another component — the sheet's
 * chrome is `BottomSheet`'s, and these are its body's rows and fields. */
export function makeStyles(theme: Theme) {
  return StyleSheet.create({
    types: {
      flexDirection: "row",
      gap: theme.spacing.xs,
      marginHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.sm,
      padding: 3,
      borderRadius: 999,
      backgroundColor: theme.colors.background,
    },
    type: {
      flex: 1,
      alignItems: "center",
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
    },
    typeActive: { backgroundColor: theme.colors.border },
    typeText: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.sm,
      fontWeight: "500",
    },
    typeTextActive: { color: theme.colors.text },
    contextNote: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      lineHeight: 18,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
    },
    choiceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      marginHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.borderLight,
    },
    choiceLabel: {
      flex: 1,
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.md,
    },
    choiceValue: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      fontWeight: "500",
    },
    choicePlaceholder: { color: theme.colors.placeholder, fontWeight: "400" },
    tag: {
      overflow: "hidden",
      color: theme.colors.primary,
      fontSize: theme.fontSize.xs,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: theme.colors.borderLight,
    },
    fields: {
      flexDirection: "row",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
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
    hint: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSize.xs,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
    },
    status: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
    },
    error: {
      color: theme.colors.danger,
      fontSize: theme.fontSize.xs,
      lineHeight: 18,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
    },
    submit: {
      margin: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
      alignItems: "center",
      backgroundColor: theme.colors.primary,
    },
    submitDisabled: { opacity: 0.38 },
    submitText: {
      color: theme.colors.primaryText,
      fontSize: theme.fontSize.lg,
      fontWeight: "600",
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
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
    pickerLabels: { flex: 1 },
    pickerLabel: {
      color: theme.colors.text,
      fontSize: theme.fontSize.lg,
      fontWeight: "500",
    },
    pickerNote: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      marginTop: 2,
    },
  });
}

export type SheetStyles = ReturnType<typeof makeStyles>;
