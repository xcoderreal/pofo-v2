import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAccounts, useCreateAccount } from "@/hooks/useAccounts";

export default function AccountsScreen() {
  const accounts = useAccounts();
  const createAccount = useCreateAccount();
  const [name, setName] = useState("");
  const [type, setType] = useState<"brokerage" | "cash">("brokerage");

  const handleCreate = () => {
    if (!name.trim()) return;
    createAccount.mutate(
      {
        id: `acct-${Date.now()}`,
        name: name.trim(),
        account_type: type,
      },
      { onSuccess: () => setName("") },
    );
  };

  if (accounts.isLoading) {
    return (
      <View style={styles.center}>
        <Text testID="loading">Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.createRow}>
        <TextInput
          testID="input-account-name"
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Account name"
          placeholderTextColor="#aaa"
        />
        <View style={styles.typeRow}>
          {(["brokerage", "cash"] as const).map((t) => (
            <Pressable
              key={t}
              testID={`type-${t}`}
              onPress={() => setType(t)}
              style={[styles.typeBtn, type === t && styles.typeBtnSelected]}
            >
              <Text
                style={[
                  styles.typeBtnText,
                  type === t && styles.typeBtnTextSelected,
                ]}
              >
                {t}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          testID="submit-account"
          onPress={handleCreate}
          style={[styles.addButton, !name.trim() && styles.addButtonDisabled]}
          disabled={!name.trim() || createAccount.isPending}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {(accounts.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text testID="empty-accounts">No accounts yet.</Text>
        </View>
      ) : (
        <FlatList
          testID="accounts-list"
          data={accounts.data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: acct }) => (
            <View
              testID={`account-card-${acct.id}`}
              style={styles.card}
            >
              <Text style={styles.cardName}>{acct.name}</Text>
              <Text style={styles.cardType}>{acct.account_type}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  createRow: {
    padding: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
  },
  typeRow: { flexDirection: "row", gap: 8 },
  typeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  typeBtnSelected: { backgroundColor: "#4a90d9", borderColor: "#4a90d9" },
  typeBtnText: { fontSize: 13 },
  typeBtnTextSelected: { color: "#fff" },
  addButton: {
    backgroundColor: "#4a90d9",
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: "#fff", fontWeight: "600" },
  list: { padding: 16 },
  card: {
    backgroundColor: "#f9f9f9",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  cardName: { fontSize: 16, fontWeight: "600" },
  cardType: { fontSize: 13, color: "#666", marginTop: 2 },
});
