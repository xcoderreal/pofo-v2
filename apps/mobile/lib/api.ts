import type { components } from "./api-types";
import { resolveApiBaseUrl } from "./env";

const BASE_URL = resolveApiBaseUrl();

/** Backend types — generated from Pydantic models via OpenAPI. */
export type Item = components["schemas"]["ItemResponse"];
export type CreateItemRequest = components["schemas"]["CreateItemRequest"];

function resolveBase(): string {
  return BASE_URL.startsWith("/")
    ? `${window.location.origin}${BASE_URL}`
    : BASE_URL;
}

export async function fetchItems(params?: { tag?: string }): Promise<Item[]> {
  const url = new URL(`${resolveBase()}/items`);
  if (params?.tag) url.searchParams.set("tag", params.tag);
  const res = await fetch(url.toString());
  return res.json();
}

export async function fetchItem(id: string): Promise<Item> {
  const res = await fetch(`${resolveBase()}/items/${id}`);
  return res.json();
}

export async function createItem(item: CreateItemRequest): Promise<Item> {
  const res = await fetch(`${resolveBase()}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  return res.json();
}
