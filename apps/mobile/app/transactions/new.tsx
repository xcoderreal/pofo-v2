import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAccounts } from "@/hooks/useAccounts";
import { useInstruments } from "@/hooks/useInstruments";
import { useCreateTransaction } from "@/hooks/useTransactions";

export default function NewTransactionScreen() {
  const router = useRouter();
  const accounts = useAccounts();
  const instruments = useInstruments();
  const createTransaction = useCreateTransaction();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [instrumentId, setInstrumentId] = useState<string | null>(null);
  const [type, setType] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    accountId && instrumentId && quantity && price && date && !createTransaction.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setError(null);
    createTransaction.mutate(
      {
        id: `txn-${Date.now()}`,
        account_id: accountId!,
        instrument_id: instrumentId!,
        type,
        quantity: parseFloat(quantity),
        price: parseFloat(price),
        date,
      },
      {
        onSuccess: () => router.back(),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Type</Text>
      <View style={styles.typeRow}>
        {(["buy", "sell"] as const).map((t) => (
          <Pressable
            key={t}
            testID={`type-${t}`}
            onPress={() => setType(t)}
            style={[
              styles.typeBtn,
              type === t && (t === "buy" ? styles.buySelected : styles.sellSelected),
            ]}
          >
            <Text
              style={[
                styles.typeBtnText,
                type === t && styles.typeBtnTextSelected,
              ]}
            >
              {t.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Account</Text>
      <View style={styles.picker}>
        {(accounts.data ?? []).map((acct) => (
          <Pressable
            key={acct.id}
            testID={`select-account-${acct.id}`}
            onPress={() => setAccountId(acct.id)}
            style={[
              styles.option,
              accountId === acct.id && styles.optionSelected,
            ]}
          >
            <Text>{acct.name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Instrument</Text>
      <View style={styles.picker}>
        {(instruments.data ?? []).map((inst) => (
          <Pressable
            key={inst.id}
            testID={`select-instrument-${inst.id}`}
            onPress={() => setInstrumentId(inst.id)}
            style={[
              styles.option,
              instrumentId === inst.id && styles.optionSelected,
            ]}
          >
            <Text>
              {inst.ticker} — {inst.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Quantity</Text>
      <TextInput
        testID="input-quantity"
        style={styles.input}
        value={quantity}
        onChangeText={setQuantity}
        placeholder="Number of shares"
        placeholderTextColor="#aaa"
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Price per share</Text>
      <TextInput
        testID="input-price"
        style={styles.input}
        value={price}
        onChangeText={setPrice}
        placeholder="Price"
        placeholderTextColor="#aaa"
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Date</Text>
      <TextInput
        testID="input-date"
        style={styles.input}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#aaa"
      />

      {error && (
        <Text testID="transaction-error" style={styles.error}>
          {error}
        </Text>
      )}

      <Pressable
        testID="submit-transaction"
        onPress={handleSubmit}
        style={[styles.submit, !canSubmit && styles.submitDisabled]}
        disabled={!canSubmit}
      >
        <Text style={styles.submitText}>
          {createTransaction.isPending ? "Logging..." : `Log ${type.toUpperCase()}`}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 12, marginBottom: 4 },
  typeRow: { flexDirection: "row", gap: 8 },
  typeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
  },
  buySelected: { backgroundColor: "#2e7d32", borderColor: "#2e7d32" },
  sellSelected: { backgroundColor: "#c62828", borderColor: "#c62828" },
  typeBtnText: { fontWeight: "600" },
  typeBtnTextSelected: { color: "#fff" },
  picker: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  optionSelected: { backgroundColor: "#4a90d9", borderColor: "#4a90d9" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
  },
  error: { color: "#c62828", marginTop: 8, fontSize: 14 },
  submit: {
    marginTop: 20,
    backgroundColor: "#4a90d9",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
