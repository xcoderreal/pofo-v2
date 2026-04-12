import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCategories } from "@/hooks/useCategories";

export default function CategoriesScreen() {
  const router = useRouter();
  const categories = useCategories();

  if (categories.isLoading) {
    return (
      <View style={styles.center}>
        <Text testID="loading">Loading...</Text>
      </View>
    );
  }

  if ((categories.data ?? []).length === 0) {
    return (
      <View style={styles.center}>
        <Text testID="empty-categories">No categories yet.</Text>
      </View>
    );
  }

  return (
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
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  card: {
    backgroundColor: "#f9f9f9",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  name: { fontSize: 18, fontWeight: "600" },
});
