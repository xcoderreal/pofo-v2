import type { components } from "./api-types";
import { resolveApiBaseUrl } from "./env";

const BASE_URL = resolveApiBaseUrl();

/** Backend types — generated from Pydantic models via OpenAPI. */
export type Item = components["schemas"]["ItemResponse"];
export type CreateItemRequest = components["schemas"]["CreateItemRequest"];
export type Category = components["schemas"]["CategoryResponse"];
export type CreateCategoryRequest = components["schemas"]["CreateCategoryRequest"];

function resolveBase(): string {
  return BASE_URL.startsWith("/")
    ? `${window.location.origin}${BASE_URL}`
    : BASE_URL;
}

// ─── Items ───────────────────────────────────────────────────

export async function fetchItems(params?: {
  tag?: string;
  category_id?: string;
}): Promise<Item[]> {
  const url = new URL(`${resolveBase()}/items`);
  if (params?.tag) url.searchParams.set("tag", params.tag);
  if (params?.category_id)
    url.searchParams.set("category_id", params.category_id);
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

export async function deleteItem(id: string): Promise<void> {
  await fetch(`${resolveBase()}/items/${id}`, { method: "DELETE" });
}

// ─── Categories ──────────────────────────────────────────────

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${resolveBase()}/categories`);
  return res.json();
}

export async function fetchCategory(id: string): Promise<Category> {
  const res = await fetch(`${resolveBase()}/categories/${id}`);
  return res.json();
}

export async function createCategory(
  data: CreateCategoryRequest,
): Promise<Category> {
  const res = await fetch(`${resolveBase()}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteCategory(id: string): Promise<void> {
  await fetch(`${resolveBase()}/categories/${id}`, { method: "DELETE" });
}
