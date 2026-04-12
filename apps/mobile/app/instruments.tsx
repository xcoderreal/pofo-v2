import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useCreateInstrument,
  useInstruments,
} from "@/hooks/useInstruments";

export default function InstrumentsScreen() {
  const instruments = useInstruments();
  const createInstrument = useCreateInstrument();
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");

  const handleCreate = () => {
    if (!ticker.trim() || !name.trim()) return;
    createInstrument.mutate(
      {
        id: `inst-${Date.now()}`,
        ticker: ticker.trim().toUpperCase(),
        name: name.trim(),
      },
      {
        onSuccess: () => {
          setTicker("");
          setName("");
        },
      },
    );
  };

  if (instruments.isLoading) {
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
          testID="input-ticker"
          style={styles.input}
          value={ticker}
          onChangeText={setTicker}
          placeholder="Ticker (e.g. AAPL)"
          placeholderTextColor="#aaa"
          autoCapitalize="characters"
        />
        <TextInput
          testID="input-instrument-name"
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Company name"
          placeholderTextColor="#aaa"
        />
        <Pressable
          testID="submit-instrument"
          onPress={handleCreate}
          style={[
            styles.addButton,
            (!ticker.trim() || !name.trim()) && styles.addButtonDisabled,
          ]}
          disabled={
            !ticker.trim() || !name.trim() || createInstrument.isPending
          }
        >
          <Text style={styles.addButtonText}>Add Instrument</Text>
        </Pressable>
      </View>

      {(instruments.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text testID="empty-instruments">No instruments yet.</Text>
        </View>
      ) : (
        <FlatList
          testID="instruments-list"
          data={instruments.data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: inst }) => (
            <View testID={`instrument-card-${inst.id}`} style={styles.card}>
              <Text style={styles.ticker}>{inst.ticker}</Text>
              <Text style={styles.name}>{inst.name}</Text>
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
  ticker: { fontSize: 18, fontWeight: "700" },
  name: { fontSize: 14, color: "#666", marginTop: 2 },
});
