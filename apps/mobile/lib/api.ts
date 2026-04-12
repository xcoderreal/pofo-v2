import type { components } from "./api-types";
import { resolveApiBaseUrl } from "./env";

const BASE_URL = resolveApiBaseUrl();

/** Backend types — generated from Pydantic models via OpenAPI. */
export type Account = components["schemas"]["AccountResponse"];
export type CreateAccountRequest = components["schemas"]["CreateAccountRequest"];
export type Instrument = components["schemas"]["InstrumentResponse"];
export type CreateInstrumentRequest =
  components["schemas"]["CreateInstrumentRequest"];
export type Transaction = components["schemas"]["TransactionResponse"];
export type CreateTransactionRequest =
  components["schemas"]["CreateTransactionRequest"];
export type Position = components["schemas"]["PositionResponse"];
export type RealizedGain = components["schemas"]["RealizedGainResponse"];
export type DailyValue = components["schemas"]["DailyValueResponse"];

function resolveBase(): string {
  return BASE_URL.startsWith("/")
    ? `${window.location.origin}${BASE_URL}`
    : BASE_URL;
}

// ─── Accounts ───────────────────────────────────────────────

export async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch(`${resolveBase()}/accounts`);
  return res.json();
}

export async function fetchAccount(id: string): Promise<Account> {
  const res = await fetch(`${resolveBase()}/accounts/${id}`);
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
  return res.json();
}

export async function deleteAccount(id: string): Promise<void> {
  await fetch(`${resolveBase()}/accounts/${id}`, { method: "DELETE" });
}

// ─── Instruments ────────────────────────────────────────────

export async function fetchInstruments(): Promise<Instrument[]> {
  const res = await fetch(`${resolveBase()}/instruments`);
  return res.json();
}

export async function fetchInstrument(id: string): Promise<Instrument> {
  const res = await fetch(`${resolveBase()}/instruments/${id}`);
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
  return res.json();
}

export async function deleteInstrument(id: string): Promise<void> {
  await fetch(`${resolveBase()}/instruments/${id}`, { method: "DELETE" });
}

// ─── Transactions ───────────────────────────────────────────

export async function fetchTransactions(params?: {
  account_id?: string;
  instrument_id?: string;
}): Promise<Transaction[]> {
  const url = new URL(`${resolveBase()}/transactions`);
  if (params?.account_id)
    url.searchParams.set("account_id", params.account_id);
  if (params?.instrument_id)
    url.searchParams.set("instrument_id", params.instrument_id);
  const res = await fetch(url.toString());
  return res.json();
}

export async function createTransaction(
  data: CreateTransactionRequest,
): Promise<Transaction> {
  const res = await fetch(`${resolveBase()}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create transaction");
  }
  return res.json();
}

export async function deleteTransaction(id: string): Promise<void> {
  await fetch(`${resolveBase()}/transactions/${id}`, { method: "DELETE" });
}

// ─── Positions (computed) ───────────────────────────────────

export async function fetchPositions(params?: {
  account_id?: string;
  instrument_id?: string;
}): Promise<Position[]> {
  const url = new URL(`${resolveBase()}/positions`);
  if (params?.account_id)
    url.searchParams.set("account_id", params.account_id);
  if (params?.instrument_id)
    url.searchParams.set("instrument_id", params.instrument_id);
  const res = await fetch(url.toString());
  return res.json();
}

// ─── Capital gains (computed) ───────────────────────────────

export async function fetchGains(params?: {
  account_id?: string;
  instrument_id?: string;
}): Promise<RealizedGain[]> {
  const url = new URL(`${resolveBase()}/gains`);
  if (params?.account_id)
    url.searchParams.set("account_id", params.account_id);
  if (params?.instrument_id)
    url.searchParams.set("instrument_id", params.instrument_id);
  const res = await fetch(url.toString());
  return res.json();
}

// ─── Portfolio history (computed) ───────────────────────────

export async function fetchHistory(params?: {
  account_id?: string;
}): Promise<DailyValue[]> {
  const url = new URL(`${resolveBase()}/history`);
  if (params?.account_id)
    url.searchParams.set("account_id", params.account_id);
  const res = await fetch(url.toString());
  return res.json();
}
