import { Pressable, StyleSheet, Text } from "react-native";
import type { Item } from "@/lib/api";

interface Props {
  item: Item;
  categoryName?: string;
  onPress?: () => void;
}

export function ItemCard({ item, categoryName, onPress }: Props) {
  return (
    <Pressable
      testID={`item-card-${item.id}`}
      onPress={onPress}
      style={styles.card}
    >
      <Text testID={`item-name-${item.id}`} style={styles.name}>
        {item.name}
      </Text>
      {item.description ? (
        <Text style={styles.desc}>{item.description}</Text>
      ) : null}
      {categoryName ? (
        <Text testID={`item-category-${item.id}`} style={styles.category}>
          {categoryName}
        </Text>
      ) : null}
      {item.tags.length > 0 && (
        <Text style={styles.tags}>{item.tags.join(", ")}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f9f9f9",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  name: { fontSize: 18, fontWeight: "600" },
  desc: { fontSize: 14, color: "#666", marginTop: 4 },
  category: { fontSize: 13, color: "#4a90d9", marginTop: 4 },
  tags: { fontSize: 12, color: "#999", marginTop: 4 },
});
