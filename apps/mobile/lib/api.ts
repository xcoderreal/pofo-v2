import { Platform } from "react-native";

declare const process: { env: Record<string, string | undefined> };

const getBaseUrl = () => {
  if (Platform.OS === "android") return "http://10.0.2.2:8090";
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8090";
    }
    // LAN dev: same host, API on port 8090
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
      return `${protocol}//${hostname}:8090`;
    }
    // Production (Vercel): same-origin, API at /api
    return "/api";
  }
  return "http://localhost:8090";
};

const BASE_URL = getBaseUrl();

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
