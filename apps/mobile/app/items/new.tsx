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
import { useCategories } from "@/hooks/useCategories";
import { useCreateItem } from "@/hooks/useItems";

export default function NewItemScreen() {
  const router = useRouter();
  const createItem = useCreateItem();
  const categories = useCategories();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!name.trim()) return;
    const id = `item-${Date.now()}`;
    createItem.mutate(
      {
        id,
        name: name.trim(),
        description: description.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        category_id: categoryId,
      },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Name</Text>
      <TextInput
        testID="input-name"
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Item name"
        placeholderTextColor="#aaa"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        testID="input-description"
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="Optional description"
        placeholderTextColor="#aaa"
      />

      <Text style={styles.label}>Tags (comma-separated)</Text>
      <TextInput
        testID="input-tags"
        style={styles.input}
        value={tags}
        onChangeText={setTags}
        placeholder="tag1, tag2"
        placeholderTextColor="#aaa"
      />

      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryPicker}>
        <Pressable
          testID="category-none"
          onPress={() => setCategoryId(null)}
          style={[
            styles.categoryOption,
            categoryId === null && styles.categorySelected,
          ]}
        >
          <Text>None</Text>
        </Pressable>
        {(categories.data ?? []).map((cat) => (
          <Pressable
            key={cat.id}
            testID={`category-option-${cat.id}`}
            onPress={() => setCategoryId(cat.id)}
            style={[
              styles.categoryOption,
              categoryId === cat.id && styles.categorySelected,
            ]}
          >
            <Text>{cat.name}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        testID="submit-item"
        onPress={handleSubmit}
        style={[styles.submit, !name.trim() && styles.submitDisabled]}
        disabled={!name.trim() || createItem.isPending}
      >
        <Text style={styles.submitText}>
          {createItem.isPending ? "Creating..." : "Create Item"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
  },
  categoryPicker: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  categorySelected: { backgroundColor: "#4a90d9", borderColor: "#4a90d9" },
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
