import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ActivityEmpty, ActivityList } from "@/components/ActivityList";
import { ScopeChips } from "@/components/ScopeChips";
import { UndoToast } from "@/components/UndoToast";
import { useActivity } from "@/hooks/useActivity";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { useTheme } from "@/hooks/useTheme";
import { useSharedViewState } from "@/hooks/useViewState";
import {
  buildChips,
  clearAccount,
  clearInstrument,
  type ScopeChip,
} from "@/lib/drilldown";

/**
 * The Activity tab — the Transaction ledger, month-grouped, newest first
 * (docs/design/dashboard_v2/behaviour.md § Activity).
 *
 * Thin by design (CLAUDE.md § "Pages are thin"): the suppression rule, the
 * grouping and every formatted figure come from `lib/activity.ts` via
 * `useActivity`, and the chips are the same shared view state the
 * Portfolio and Grid tabs read. Arriving here with a slice selected on
 * another tab shows that slice's transactions — the scope is the app's,
 * not the screen's (#20 lifted it above the navigator for exactly this).
 */
export default function ActivityScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const view = useSharedViewState();
  const activity = useActivity();
  const instruments = useInstruments();
  const accounts = useAccounts();

  const chips = useMemo(
    () =>
      buildChips({
        scope: view.state,
        instruments: instruments.data,
        accounts: accounts.data,
      }),
    [view.state, instruments.data, accounts.data],
  );

  // Same Undo contract as the Portfolio tab: clearing a chip snapshots the
  // whole view state and offers it back for five seconds (behaviour.md
  // § Undo toast). A chip dismissed here is dismissed everywhere, so it
  // must be as recoverable here as it is there.
  const onClearChip = useCallback(
    (kind: ScopeChip["kind"]) =>
      kind === "instrument"
        ? view.updateWithUndo(
            "Instrument filter removed",
            clearInstrument(view.state),
          )
        : view.updateWithUndo("Account filter removed", clearAccount(view.state)),
    [view],
  );

  if (activity.errorMessage !== null) {
    return (
      <View testID="activity-screen" style={styles.centered}>
        <Text testID="activity-error" style={styles.error}>
          {activity.errorMessage}
        </Text>
      </View>
    );
  }

  return (
    <View testID="activity-screen" style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <Text testID="activity-scope" style={styles.scope}>
          {activity.scopeLabel}
        </Text>
      </View>

      {chips.length === 0 ? null : (
        <ScopeChips chips={chips} onClear={onClearChip} />
      )}

      {activity.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator
            testID="activity-loading"
            color={theme.colors.primary}
          />
        </View>
      ) : (
        <ScrollView
          testID="activity-scroll"
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          {activity.months.length === 0 ? (
            <ActivityEmpty isFiltered={activity.isFiltered} />
          ) : (
            <ActivityList months={activity.months} />
          )}
        </ScrollView>
      )}

      {view.toast === null ? null : (
        <UndoToast
          message={view.toast.message}
          onUndo={view.undo}
          onDismiss={view.dismissToast}
        />
      )}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: { flex: 1 },
    content: { paddingBottom: theme.spacing.xl },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.xl,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.fontSize.xl,
      fontWeight: "800",
    },
    scope: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
    },
    error: {
      color: theme.colors.danger,
      fontSize: theme.fontSize.md,
      paddingHorizontal: theme.spacing.lg,
      textAlign: "center",
    },
  });
}
