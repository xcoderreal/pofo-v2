import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BottomSheet } from "@/components/BottomSheet";
import { useTheme } from "@/hooks/useTheme";
import { useTransactionEntry } from "@/hooks/useTransactionEntry";
import {
  ENTRY_KINDS,
  ENTRY_SHEET_SUBTITLE,
  entryKindLabel,
  type EntryField,
} from "@/lib/transactionEntry";
import { ChoiceRow, Field, PickerRow } from "./rows";
import { makeStyles } from "./styles";

interface Props {
  onClose: () => void;
}

/** Which picker has taken over the sheet's body, if any. Inline rather
 * than a second `BottomSheet` stacked on the first: two overlays deep is a
 * scrim over a scrim, and the sheet's whole reason for not using RN's
 * `Modal` is to keep one render tree per screen. */
type Picker = "account" | "instrument" | null;

/**
 * The transaction entry sheet — the only way data gets in.
 *
 * Thin by the same rule the screens follow: every decision (which fields
 * this type shows, what came from the view, whether the sell fits, what
 * the server's rejection means) is `useTransactionEntry` calling pure
 * functions in `lib/transactionEntry.ts`. What is here is the JSX.
 *
 * Neither picker offers "add new". Instrument creation is #23 and account
 * creation is #24 — the seam is the picker's own list, built from the
 * catalogs, which those tickets will simply grow a row on.
 */
export function TransactionSheet({ onClose }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const entry = useTransactionEntry({ onClose });
  const [picker, setPicker] = useState<Picker>(null);

  if (picker !== null) {
    const options =
      picker === "account" ? entry.accountOptions : entry.instrumentOptions;
    return (
      <BottomSheet
        testID="entry-sheet"
        title={picker === "account" ? "Account" : "Instrument"}
        subtitle={
          picker === "account"
            ? "Where this posts. The trade's cash leg posts here too."
            : "What was traded. Cash movements are a Deposit or a Withdrawal instead."
        }
        onClose={() => setPicker(null)}
      >
        {options.length === 0 ? (
          <Text testID="entry-picker-empty" style={styles.status}>
            Nothing to choose from yet.
          </Text>
        ) : (
          options.map((option) => (
            <PickerRow
              key={option.id}
              testID={`entry-picker-${picker}-${option.id}`}
              option={option}
              styles={styles}
              onPress={() => {
                if (picker === "account") entry.setAccount(option.id);
                else entry.setInstrument(option.id);
                setPicker(null);
              }}
            />
          ))
        )}
      </BottomSheet>
    );
  }

  const shows = (field: EntryField) => entry.fields.includes(field);
  const blocked = entry.blockedReason !== null || entry.isSubmitting;

  return (
    <BottomSheet
      testID="entry-sheet"
      title={entry.title}
      subtitle={ENTRY_SHEET_SUBTITLE}
      onClose={onClose}
    >
      <View testID="entry-types" style={styles.types}>
        {ENTRY_KINDS.map((kind) => {
          const active = entry.draft.kind === kind;
          return (
            <Pressable
              key={kind}
              testID={`entry-type-${kind}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => entry.setKind(kind)}
              style={[styles.type, active && styles.typeActive]}
            >
              {/* Which segment is on is a colour difference, and a colour
                  difference is not assertable — the marker testID is how
                  the other sheets already expose their selection. */}
              <Text
                testID={active ? `entry-type-selected-${kind}` : undefined}
                style={[styles.typeText, active && styles.typeTextActive]}
              >
                {entryKindLabel(kind)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text testID="entry-context-note" style={styles.contextNote}>
        {entry.contextNote}
      </Text>

      <ChoiceRow
        testID="entry-row-account"
        label="Account"
        value={entry.accountOptions.find((o) => o.selected)?.label ?? "Choose…"}
        placeholder={entry.draft.accountId === null}
        fromContext={entry.isFromContext("account")}
        styles={styles}
        onPress={() => setPicker("account")}
      />

      {shows("instrument") ? (
        <ChoiceRow
          testID="entry-row-instrument"
          label="Instrument"
          value={
            entry.instrumentOptions.find((o) => o.selected)?.label ?? "Choose…"
          }
          placeholder={entry.draft.instrumentId === null}
          fromContext={entry.isFromContext("instrument")}
          styles={styles}
          onPress={() => setPicker("instrument")}
        />
      ) : null}

      <View style={styles.fields}>
        {shows("quantity") ? (
          <Field
            label="Units"
            testID="entry-input-quantity"
            value={entry.draft.quantity}
            placeholder="0"
            onChange={(text) => entry.setField("quantity", text)}
            styles={styles}
            theme={theme}
          />
        ) : null}
        {shows("price") ? (
          <Field
            label="Price per unit"
            testID="entry-input-price"
            value={entry.draft.price}
            placeholder="0.00"
            onChange={(text) => entry.setField("price", text)}
            styles={styles}
            theme={theme}
          />
        ) : null}
        {shows("amount") ? (
          <Field
            label="Amount"
            testID="entry-input-amount"
            value={entry.draft.amount}
            placeholder="0.00"
            onChange={(text) => entry.setField("amount", text)}
            styles={styles}
            theme={theme}
          />
        ) : null}
        <Field
          label="Date"
          testID="entry-input-date"
          value={entry.draft.date}
          placeholder="YYYY-MM-DD"
          onChange={(text) => entry.setField("date", text)}
          styles={styles}
          theme={theme}
        />
      </View>

      {/* Both directions of #22's validation: what a Sell can draw on, and
          what a Buy has to pay with. The second is not a client-side
          block — see `validateEntry`. */}
      {entry.hint === null ? null : (
        <Text testID="entry-hint" style={styles.hint}>
          {entry.hint}
        </Text>
      )}

      {entry.errorMessage === null ? null : (
        <Text testID="entry-error" style={styles.error}>
          {entry.errorMessage}
        </Text>
      )}

      {entry.blockedReason === null ? null : (
        <Text testID="entry-status" style={styles.status}>
          {entry.blockedReason}
        </Text>
      )}

      <Pressable
        testID="entry-submit"
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={entry.submit}
        style={[styles.submit, blocked && styles.submitDisabled]}
      >
        <Text style={styles.submitText}>
          {entry.isSubmitting ? "Recording…" : entry.ctaLabel}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}
