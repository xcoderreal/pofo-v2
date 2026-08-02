import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/BottomSheet";
import { useAccounts, useCreateAccount, useDeleteAccount } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { useLedger } from "@/hooks/useActivity";
import { usePositions } from "@/hooks/usePositions";
import { useTheme } from "@/hooks/useTheme";
import {
  ACCOUNT_TYPES,
  buildDeletionSummary,
  confirmationMatches,
  describeAccountDeletion,
  INITIAL_ACCOUNT_DRAFT,
  validateAccountDraft,
  type AccountDraft,
} from "@/lib/accounts";
import { accountTypeLabel } from "@/lib/positions";
import type { Theme } from "@/utils/theme";

/**
 * The two sheets an Account's life needs: create one, and destroy one.
 *
 * They live together because they are the same surface seen from both
 * ends, and because the design has no screen for either — the prototype
 * covers neither (docs/design/dashboard_v2/behaviour.md § Known prototype
 * gaps), so both are built from #24 and the ADR rather than transcribed.
 *
 * Thin, like every other sheet here: `lib/accounts.ts` decides what a
 * draft becomes, what a deletion destroys and whether a confirmation
 * counts, and all three are covered by `bun test`. What is here is the
 * JSX and the local draft state.
 *
 * Both reuse `BottomSheet` — an absolute overlay inside the screen's own
 * root, not RN's `Modal`, so one render tree per screen holds.
 */

// ─── Create ───────────────────────────────────────────────────

/** Six random characters, appended to the name's slug so a global id
 * collision can't reject a legitimate name (or reveal that another user
 * owns one) — see `validateAccountDraft`. */
function idSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function NewAccountSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Fires with the new account's id — the caller decides whether that
   * means "select it" or just "close". */
  onCreated?: (accountId: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const create = useCreateAccount();
  const { mutate, reset } = create;

  const [draft, setDraft] = useState<AccountDraft>(INITIAL_ACCOUNT_DRAFT);
  // Fixed for the life of the sheet: a suffix that changed on every
  // keystroke would make the id a moving target between validation and
  // submit.
  const [suffix] = useState(idSuffix);

  const validation = validateAccountDraft(draft, suffix);
  const blocked = !validation.ok || create.isPending;

  // Every edit clears the last rejection — a message about the values that
  // were submitted is wrong the moment one of them changes.
  const edit = (patch: Partial<AccountDraft>) => {
    reset();
    setDraft((current) => ({ ...current, ...patch }));
  };

  return (
    <BottomSheet
      testID="account-sheet"
      title="New account"
      subtitle="A holding vehicle — a brokerage, an IRA, an exchange, or somewhere cash just sits. Transactions are recorded into one."
      onClose={onClose}
    >
      <View style={styles.fields}>
        <Field
          label="Name"
          testID="account-input-name"
          value={draft.name}
          placeholder="Wells Fargo Brokerage"
          onChange={(name) => edit({ name })}
          styles={styles}
          theme={theme}
        />
        <Field
          label="Institution"
          testID="account-input-institution"
          value={draft.institution}
          placeholder="Wells Fargo"
          onChange={(institution) => edit({ institution })}
          styles={styles}
          theme={theme}
        />
      </View>

      <Text style={styles.sectionLabel}>Type</Text>
      <View testID="account-types" style={styles.types}>
        {ACCOUNT_TYPES.map((accountType) => {
          const active = draft.accountType === accountType;
          return (
            <Pressable
              key={accountType}
              testID={`account-type-${accountType}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => edit({ accountType })}
              style={[styles.type, active && styles.typeActive]}
            >
              {/* Which segment is on is a colour difference, and a colour
                  difference is not assertable — the marker testID is how
                  every other sheet here exposes its selection. */}
              <Text
                testID={active ? `account-type-selected-${accountType}` : undefined}
                style={[styles.typeText, active && styles.typeTextActive]}
              >
                {accountTypeLabel(accountType)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {create.error === null ? null : (
        <Text testID="account-error" style={styles.error}>
          {create.error.message}
        </Text>
      )}

      {validation.ok ? null : (
        <Text testID="account-status" style={styles.status}>
          {validation.reason}
        </Text>
      )}

      <Pressable
        testID="account-submit"
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={() => {
          if (!validation.ok) return;
          const { id } = validation.request;
          mutate(validation.request, {
            onSuccess: () => {
              onCreated?.(id);
              onClose();
            },
          });
        }}
        style={[styles.submit, blocked && styles.submitDisabled]}
      >
        <Text style={styles.submitText}>
          {create.isPending ? "Creating…" : "Create account"}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

// ─── Delete ───────────────────────────────────────────────────

export function DeleteAccountSheet({
  accountId,
  onClose,
  onDeleted,
}: {
  accountId: string;
  onClose: () => void;
  /** Fires *before* the sheet closes, so the caller can drop a scope that
   * names the account that just stopped existing (#24 AC 7). */
  onDeleted: (accountId: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const accounts = useAccounts();
  const instruments = useInstruments();
  const positions = usePositions();
  // Memoised because the query key *is* this object — a fresh literal each
  // render would be a fresh cache entry each render.
  const ledgerQuery = useMemo(() => ({ accounts: [accountId] }), [accountId]);
  const ledger = useLedger(ledgerQuery);
  const remove = useDeleteAccount();

  const [typed, setTyped] = useState("");

  const name =
    (accounts.data ?? []).find((account) => account.id === accountId)?.name ??
    accountId;

  const summary = useMemo(
    () =>
      buildDeletionSummary({
        accountId,
        entries: ledger.data,
        positions: positions.data,
        instruments: instruments.data,
      }),
    [accountId, ledger.data, positions.data, instruments.data],
  );

  // The confirmation has to *state* what will be destroyed, so the button
  // stays out of reach until the figures behind that sentence have
  // actually arrived. A summary computed from an empty cache reads
  // "0 transactions and $0.00", which is a lie with a delete button
  // under it.
  const counted = ledger.isSuccess && positions.isSuccess;
  const matched = confirmationMatches(typed, name);
  const blocked = !counted || !matched || remove.isPending;

  return (
    <BottomSheet
      testID="account-delete-sheet"
      title={`Delete ${name}`}
      subtitle="Removes the account, its transactions — including the cash legs its trades posted — and everything computed from them."
      onClose={onClose}
    >
      {counted ? (
        <Text testID="account-delete-summary" style={styles.summary}>
          {describeAccountDeletion(summary)}
        </Text>
      ) : (
        <Text testID="account-delete-counting" style={styles.summary}>
          Counting what this would destroy…
        </Text>
      )}

      <View style={styles.fields}>
        <Field
          label={`Type “${name}” to confirm`}
          testID="account-delete-confirm"
          value={typed}
          placeholder={name}
          onChange={setTyped}
          styles={styles}
          theme={theme}
        />
      </View>

      {remove.error === null ? null : (
        <Text testID="account-delete-error" style={styles.error}>
          {remove.error.message}
        </Text>
      )}

      <Pressable
        testID="account-delete-submit"
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={() =>
          remove.mutate(accountId, {
            onSuccess: () => {
              onDeleted(accountId);
              onClose();
            },
          })
        }
        style={[styles.submit, styles.destructive, blocked && styles.submitDisabled]}
      >
        <Text style={styles.submitText}>
          {remove.isPending ? "Deleting…" : "Delete account"}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

// ─── Shared pieces ────────────────────────────────────────────

function Field({
  label,
  testID,
  value,
  placeholder,
  onChange,
  styles,
  theme,
}: {
  label: string;
  testID: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.placeholder}
        autoCapitalize="words"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    types: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.xs,
    },
    type: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
      backgroundColor: theme.colors.background,
    },
    typeActive: { backgroundColor: theme.colors.border },
    typeText: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.sm,
      fontWeight: "500",
    },
    typeTextActive: { color: theme.colors.text },
    fields: {
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
    },
    field: { gap: theme.spacing.xs },
    fieldLabel: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
    },
    // The same label, one level out — `fields` supplies the horizontal
    // padding its own children inherit, and the Type row is a sibling of
    // that block rather than a member of it.
    sectionLabel: {
      color: theme.colors.textTertiary,
      fontSize: theme.fontSize.xs,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
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
    summary: {
      color: theme.colors.text,
      fontSize: theme.fontSize.md,
      lineHeight: 20,
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
    destructive: { backgroundColor: theme.colors.danger },
    submitDisabled: { opacity: 0.38 },
    submitText: {
      color: theme.colors.primaryText,
      fontSize: theme.fontSize.lg,
      fontWeight: "600",
    },
  });
}
