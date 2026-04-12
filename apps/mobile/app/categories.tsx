import { useRouter } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCategories, useCreateCategory } from "@/hooks/useCategories";

export default function CategoriesScreen() {
  const router = useRouter();
  const categories = useCategories();
  const createCategory = useCreateCategory();
  const [name, setName] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    createCategory.mutate(
      { id: `cat-${Date.now()}`, name: name.trim() },
      { onSuccess: () => setName("") },
    );
  };

  if (categories.isLoading) {
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
          testID="input-category-name"
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="New category name"
          placeholderTextColor="#aaa"
        />
        <Pressable
          testID="submit-category"
          onPress={handleCreate}
          style={[styles.addButton, !name.trim() && styles.addButtonDisabled]}
          disabled={!name.trim() || createCategory.isPending}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      {(categories.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text testID="empty-categories">No categories yet.</Text>
        </View>
      ) : (
        <FlatList
          testID="categories-list"
          data={categories.data}
          keyExtractor={(cat) => cat.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: cat }) => (
            <Pressable
              testID={`category-card-${cat.id}`}
              onPress={() => router.push(`/?category_id=${cat.id}`)}
              style={styles.card}
            >
              <Text testID={`category-name-${cat.id}`} style={styles.name}>
                {cat.name}
              </Text>
            </Pressable>
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
    flexDirection: "row",
    padding: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: "#4a90d9",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    justifyContent: "center",
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
  name: { fontSize: 18, fontWeight: "600" },
});
