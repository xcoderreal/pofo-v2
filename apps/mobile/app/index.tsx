import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCreateInstrument, useInstruments } from "@/hooks/useInstruments";
import { instrumentIdFromSymbol } from "@/lib/instruments";

const ASSET_CLASSES = ["equity", "etf", "crypto", "cash"] as const;

export default function HomeScreen() {
  const instruments = useInstruments();
  const createInstrument = useCreateInstrument();

  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] =
    useState<(typeof ASSET_CLASSES)[number]>("equity");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    createInstrument.mutate(
      {
        id: instrumentIdFromSymbol(symbol),
        symbol: symbol.trim(),
        name: name.trim(),
        asset_class: assetClass,
      },
      {
        onSuccess: () => {
          setSymbol("");
          setName("");
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <View style={styles.container}>
      <View testID="create-instrument-form" style={styles.form}>
        <TextInput
          testID="input-symbol"
          placeholder="Symbol (e.g. GOOG)"
          value={symbol}
          onChangeText={setSymbol}
          style={styles.input}
        />
        <TextInput
          testID="input-name"
          placeholder="Name (e.g. Alphabet Inc)"
          value={name}
          onChangeText={setName}
          style={styles.input}
        />
        <View testID="asset-class-picker" style={styles.assetClassRow}>
          {ASSET_CLASSES.map((ac) => (
            <Pressable
              key={ac}
              testID={`asset-class-option-${ac}`}
              onPress={() => setAssetClass(ac)}
              style={[
                styles.assetClassOption,
                assetClass === ac && styles.assetClassOptionSelected,
              ]}
            >
              <Text>{ac}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          testID="submit-instrument"
          onPress={handleSubmit}
          disabled={!symbol.trim() || !name.trim()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Add instrument</Text>
        </Pressable>
        {error ? (
          <Text testID="create-instrument-error" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      {instruments.isLoading ? (
        <View style={styles.center}>
          <Text testID="loading">Loading...</Text>
        </View>
      ) : (instruments.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text testID="empty-state">No instruments yet.</Text>
        </View>
      ) : (
        <FlatList
          testID="instruments-list"
          data={instruments.data}
          keyExtractor={(instrument) => instrument.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View testID={`instrument-card-${item.id}`} style={styles.card}>
              <Text testID={`instrument-symbol-${item.id}`}>
                {item.symbol}
              </Text>
              <Text>{item.name}</Text>
              <Text>{item.asset_class}</Text>
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
  assetClassRow: { flexDirection: "row", gap: 8 },
  assetClassOption: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assetClassOptionSelected: {
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
