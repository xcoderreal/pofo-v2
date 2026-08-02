import type { components } from "./api-types";
import { resolveApiBaseUrl } from "./env";

const BASE_URL = resolveApiBaseUrl();

/** Backend types — generated from Pydantic models via OpenAPI. */
export type Instrument = components["schemas"]["InstrumentResponse"];
export type CreateInstrumentRequest =
  components["schemas"]["CreateInstrumentRequest"];
export type Account = components["schemas"]["AccountResponse"];
export type CreateAccountRequest = components["schemas"]["CreateAccountRequest"];

function resolveBase(): string {
  return BASE_URL.startsWith("/")
    ? `${window.location.origin}${BASE_URL}`
    : BASE_URL;
}

// ─── Instruments ────────────────────────────────────────────

export async function fetchInstruments(): Promise<Instrument[]> {
  const res = await fetch(`${resolveBase()}/instruments`);
  if (!res.ok) {
    throw new Error(`Failed to fetch instruments (${res.status})`);
  }
  return res.json();
}

export async function createInstrument(
  data: CreateInstrumentRequest,
): Promise<Instrument> {
  const res = await fetch(`${resolveBase()}/instruments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Failed to create instrument (${res.status})`);
  }
  return res.json();
}

// ─── Accounts ───────────────────────────────────────────────

export async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch(`${resolveBase()}/accounts`);
  if (!res.ok) {
    throw new Error(`Failed to fetch accounts (${res.status})`);
  }
  return res.json();
}

export async function createAccount(
  data: CreateAccountRequest,
): Promise<Account> {
  const res = await fetch(`${resolveBase()}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Failed to create account (${res.status})`);
  }
  return res.json();
}
