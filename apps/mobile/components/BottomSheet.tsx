import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  testID: string;
  title: string;
  /** One line saying what the choice applies to — every sheet in the
   * design carries one, because "Metric" alone doesn't say whether it
   * affects the chart, the list or both. */
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The dashboard's modal surface: a scrim over the screen and a panel
 * pinned to the bottom.
 *
 * Deliberately not React Native's `Modal`. Everything here renders inside
 * the screen's own root view, which keeps one render tree for the web
 * bundle to hand Playwright and means the Undo toast — also absolutely
 * positioned — composes with it instead of fighting a portal.
 */
export function BottomSheet({
  testID,
  title,
  subtitle,
  onClose,
  children,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View testID={testID} style={styles.overlay}>
      <Pressable
        testID={`${testID}-scrim`}
        accessibilityLabel="Close"
        style={styles.scrim}
        onPress={onClose}
      />
      <View style={styles.panel}>
        <View style={styles.grabber} />
        <Text testID={`${testID}-title`} style={styles.title}>
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject },
    // Occupies only the space *above* the panel rather than the whole
    // overlay. A scrim stacked behind the panel is untappable in its
    // middle — the panel eats the pointer — which is a real dead zone,
    // not just an awkward test.
    scrim: { flex: 1, backgroundColor: "#000000B0" },
    panel: {
      maxHeight: "80%",
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      paddingBottom: theme.spacing.xl,
    },
    grabber: {
      alignSelf: "center",
      width: 38,
      height: 4,
      borderRadius: 99,
      backgroundColor: theme.colors.border,
      marginTop: theme.spacing.md,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.fontSize.xl,
      fontWeight: "700",
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
    },
    subtitle: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      lineHeight: 18,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.xs,
      paddingBottom: theme.spacing.sm,
    },
    body: { flexGrow: 0 },
  });
}
