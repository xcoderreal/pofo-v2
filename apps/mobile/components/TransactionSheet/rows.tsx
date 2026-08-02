import { Pressable, Text, TextInput, View } from "react-native";
import type { EntryPickerOption } from "@/hooks/useTransactionEntry";
import type { Theme } from "@/utils/theme";
import type { SheetStyles } from "./styles";

/** One account or instrument to pick from. Same radio-dot treatment as
 * `OptionSheet`'s rows, which is what every other sheet in this design
 * uses for a mutually-exclusive choice. */
export function PickerRow({
  testID,
  option,
  styles,
  onPress,
}: {
  testID: string;
  option: EntryPickerOption;
  styles: SheetStyles;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityState={{ selected: option.selected }}
      onPress={onPress}
      style={styles.pickerRow}
    >
      <View style={[styles.dot, option.selected && styles.dotSelected]} />
      <View style={styles.pickerLabels}>
        <Text style={styles.pickerLabel}>{option.label}</Text>
        <Text style={styles.pickerNote}>{option.note}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The Account and Instrument rows: a value, tappable to change, carrying a
 * "from view" tag while it still holds what the scope supplied.
 *
 * The tag is the visible half of "prefilled fields are marked as coming
 * from context and remain editable" (#22) — marked, but not locked, and
 * the mark goes away the moment the value stops being the view's.
 */
export function ChoiceRow({
  testID,
  label,
  value,
  placeholder,
  fromContext,
  styles,
  onPress,
}: {
  testID: string;
  label: string;
  value: string;
  placeholder: boolean;
  fromContext: boolean;
  styles: SheetStyles;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.choiceRow}
    >
      <Text style={styles.choiceLabel}>{label}</Text>
      <Text
        testID={`${testID}-value`}
        style={[styles.choiceValue, placeholder && styles.choicePlaceholder]}
      >
        {value}
      </Text>
      {fromContext ? (
        <Text testID={`${testID}-tag`} style={styles.tag}>
          from view
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A typed field. Kept as free text rather than a numeric-only input: the
 * draft holds what was typed and `validateEntry` is the one place it
 * becomes a number (`lib/transactionEntry.ts`). */
export function Field({
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
  styles: SheetStyles;
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
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}
