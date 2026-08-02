import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAccounts, useCreateAccount } from "@/hooks/useAccounts";
import { accountIdFromName } from "@/lib/accounts";

const ACCOUNT_TYPES = ["brokerage", "ira", "crypto_exchange", "cash"] as const;

export default function AccountsScreen() {
  const accounts = useAccounts();
  const createAccount = useCreateAccount();

  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountType, setAccountType] =
    useState<(typeof ACCOUNT_TYPES)[number]>("brokerage");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    createAccount.mutate(
      {
        id: accountIdFromName(name),
        name: name.trim(),
        institution: institution.trim(),
        account_type: accountType,
      },
      {
        onSuccess: () => {
          setName("");
          setInstitution("");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <View style={styles.container}>
      <View testID="create-account-form" style={styles.form}>
        <TextInput
          testID="input-account-name"
          placeholder="Name (e.g. Wells Fargo Brokerage)"
          value={name}
          onChangeText={setName}
          style={styles.input}
        />
        <TextInput
          testID="input-account-institution"
          placeholder="Institution (e.g. Wells Fargo)"
          value={institution}
          onChangeText={setInstitution}
          style={styles.input}
        />
        <View testID="account-type-picker" style={styles.typeRow}>
          {ACCOUNT_TYPES.map((t) => (
            <Pressable
              key={t}
              testID={`account-type-option-${t}`}
              onPress={() => setAccountType(t)}
              style={[
                styles.typeOption,
                accountType === t && styles.typeOptionSelected,
              ]}
            >
              <Text>{t}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          testID="submit-account"
          onPress={handleSubmit}
          disabled={!name.trim() || !institution.trim()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Add account</Text>
        </Pressable>
        {error ? (
          <Text testID="create-account-error" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      {accounts.isLoading ? (
        <View style={styles.center}>
          <Text testID="loading">Loading...</Text>
        </View>
      ) : (accounts.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text testID="empty-accounts">No accounts yet.</Text>
        </View>
      ) : (
        <FlatList
          testID="accounts-list"
          data={accounts.data}
          keyExtractor={(account) => account.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View testID={`account-card-${item.id}`} style={styles.card}>
              <Text testID={`account-name-${item.id}`}>{item.name}</Text>
              <Text>{item.institution}</Text>
              <Text>{item.account_type}</Text>
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
  form: {
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 8,
  },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  typeOption: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  typeOptionSelected: {
    borderColor: "#4a90d9",
    backgroundColor: "#eaf2fb",
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
  list: { padding: 16 },
  card: {
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
  },
});
