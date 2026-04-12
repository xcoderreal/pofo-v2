import { useRouter, useLocalSearchParams } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ItemCard } from "@/components/ItemCard";
import { useCategories } from "@/hooks/useCategories";
import { useItems } from "@/hooks/useItems";

export default function HomeScreen() {
  const router = useRouter();
  const { category_id } = useLocalSearchParams<{ category_id?: string }>();
  const items = useItems(category_id ? { category_id } : undefined);
  const categories = useCategories();

  const categoryMap = new Map(
    (categories.data ?? []).map((c) => [c.id, c.name]),
  );

  if (items.isLoading) {
    return (
      <View style={styles.center}>
        <Text testID="loading">Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable
          testID="nav-new-item"
          onPress={() => router.push("/items/new")}
          style={styles.button}
        >
          <Text style={styles.buttonText}>+ Item</Text>
        </Pressable>
        <Pressable
          testID="nav-categories"
          onPress={() => router.push("/categories")}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Categories</Text>
        </Pressable>
      </View>

      {(items.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text testID="empty-state">No items yet. Add some via the API.</Text>
        </View>
      ) : (
        <FlatList
          testID="items-list"
          data={items.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ItemCard
              item={item}
              categoryName={
                item.category_id
                  ? categoryMap.get(item.category_id)
                  : undefined
              }
              onPress={() => router.push(`/items/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  toolbar: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  button: {
    backgroundColor: "#4a90d9",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  list: { padding: 16 },
});
