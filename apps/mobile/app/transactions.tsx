import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { useCreateTransaction, usePosition } from "@/hooks/useTransactions";

const TRANSACTION_TYPES = ["buy", "sell"] as const;

export default function TransactionsScreen() {
  const accounts = useAccounts();
  const instruments = useInstruments();
  const createTransaction = useCreateTransaction();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [instrumentId, setInstrumentId] = useState<string | null>(null);
  const [type, setType] = useState<(typeof TRANSACTION_TYPES)[number]>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const position = usePosition(accountId, instrumentId);

  const canSubmit = Boolean(accountId && instrumentId && quantity.trim() && price.trim());

  const handleSubmit = () => {
    if (!accountId || !instrumentId) return;
    setError(null);
    createTransaction.mutate(
      {
        account_id: accountId,
        instrument_id: instrumentId,
        type,
        quantity,
        price,
        timestamp: new Date().toISOString(),
      },
      {
        onSuccess: () => {
          setQuantity("");
          setPrice("");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <View style={styles.container}>
      <View testID="log-transaction-form" style={styles.form}>
        <Text style={styles.label}>Account</Text>
        <View testID="account-picker" style={styles.pickerRow}>
          {(accounts.data ?? []).map((account) => (
            <Pressable
              key={account.id}
              testID={`account-option-${account.id}`}
              onPress={() => setAccountId(account.id)}
              style={[
                styles.pickerOption,
                accountId === account.id && styles.pickerOptionSelected,
              ]}
            >
              <Text>{account.name}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Instrument</Text>
        <View testID="instrument-picker" style={styles.pickerRow}>
          {(instruments.data ?? []).map((instrument) => (
            <Pressable
              key={instrument.id}
              testID={`instrument-option-${instrument.id}`}
              onPress={() => setInstrumentId(instrument.id)}
              style={[
                styles.pickerOption,
                instrumentId === instrument.id && styles.pickerOptionSelected,
              ]}
            >
              <Text>{instrument.symbol}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Type</Text>
        <View testID="transaction-type-picker" style={styles.pickerRow}>
          {TRANSACTION_TYPES.map((t) => (
            <Pressable
              key={t}
              testID={`transaction-type-option-${t}`}
              onPress={() => setType(t)}
              style={[styles.pickerOption, type === t && styles.pickerOptionSelected]}
            >
              <Text>{t}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          testID="input-quantity"
          placeholder="Quantity"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <TextInput
          testID="input-price"
          placeholder="Price per unit"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Pressable
          testID="submit-transaction"
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Log transaction</Text>
        </Pressable>
        {error ? (
          <Text testID="create-transaction-error" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      {accountId && instrumentId ? (
        <View testID="position-view" style={styles.position}>
          <Text style={styles.label}>Position</Text>
          {position.isLoading ? (
            <Text testID="loading">Loading...</Text>
          ) : (
            <>
              <Text testID="position-share-count">
                Shares: {position.data?.share_count}
              </Text>
              <Text testID="position-cost-basis">
                Cost basis: {position.data?.cost_basis}
              </Text>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: {
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  label: { fontWeight: "600", marginTop: 4 },
  pickerRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pickerOption: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pickerOptionSelected: {
    borderColor: "#4a90d9",
    backgroundColor: "#eaf2fb",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 8,
  },
  button: {
    backgroundColor: "#4a90d9",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  error: { color: "#c0392b" },
  position: { padding: 16, gap: 4 },
});
