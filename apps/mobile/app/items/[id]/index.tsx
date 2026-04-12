import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useCategories } from "@/hooks/useCategories";
import { useItem } from "@/hooks/useItems";

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const categories = useCategories();

  if (item.isLoading) {
    return (
      <View style={styles.center}>
        <Text testID="loading">Loading...</Text>
      </View>
    );
  }

  if (!item.data) {
    return (
      <View style={styles.center}>
        <Text testID="not-found">Item not found.</Text>
      </View>
    );
  }

  const categoryName = item.data.category_id
    ? (categories.data ?? []).find((c) => c.id === item.data!.category_id)
        ?.name
    : undefined;

  return (
    <View style={styles.container}>
      <Text testID="item-detail-name" style={styles.name}>
        {item.data.name}
      </Text>
      {item.data.description ? (
        <Text testID="item-detail-description" style={styles.desc}>
          {item.data.description}
        </Text>
      ) : null}
      {categoryName ? (
        <Text testID="item-detail-category" style={styles.category}>
          Category: {categoryName}
        </Text>
      ) : null}
      {item.data.tags.length > 0 && (
        <Text testID="item-detail-tags" style={styles.tags}>
          Tags: {item.data.tags.join(", ")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, padding: 16 },
  name: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  desc: { fontSize: 16, color: "#666", marginBottom: 8 },
  category: { fontSize: 14, color: "#4a90d9", marginBottom: 8 },
  tags: { fontSize: 14, color: "#999" },
});
