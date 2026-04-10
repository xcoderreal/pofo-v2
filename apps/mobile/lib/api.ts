import { resolveApiBaseUrl } from "./env";

const BASE_URL = resolveApiBaseUrl();

export interface Item {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export async function fetchItems(params?: { tag?: string }): Promise<Item[]> {
  const base = BASE_URL.startsWith("/")
    ? `${window.location.origin}${BASE_URL}`
    : BASE_URL;
  const url = new URL(`${base}/items`);
  if (params?.tag) url.searchParams.set("tag", params.tag);
  const res = await fetch(url.toString());
  return res.json();
}

export async function fetchItem(id: string): Promise<Item> {
  const res = await fetch(`${BASE_URL}/items/${id}`);
  return res.json();
}

export async function createItem(
  item: Omit<Item, "id"> & { id: string }
): Promise<Item> {
  const res = await fetch(`${BASE_URL}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  return res.json();
}
