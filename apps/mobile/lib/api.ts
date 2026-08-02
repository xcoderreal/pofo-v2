import type { components } from "./api-types";
import { resolveApiBaseUrl } from "./env";

const BASE_URL = resolveApiBaseUrl();

/** Backend types — generated from Pydantic models via OpenAPI. */
export type Instrument = components["schemas"]["InstrumentResponse"];
export type CreateInstrumentRequest =
  components["schemas"]["CreateInstrumentRequest"];
export type Account = components["schemas"]["AccountResponse"];
export type CreateAccountRequest = components["schemas"]["CreateAccountRequest"];
export type CreateTransactionRequest =
  components["schemas"]["CreateTransactionRequest"];
export type Position = components["schemas"]["PositionResponse"];

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

// ─── Transactions / Positions ────────────────────────────────

export async function createTransaction(
  data: CreateTransactionRequest,
): Promise<void> {
  const res = await fetch(`${resolveBase()}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Failed to log transaction (${res.status})`);
  }
}

export async function fetchPosition(
  accountId: string,
  instrumentId: string,
): Promise<Position> {
  const res = await fetch(
    `${resolveBase()}/accounts/${accountId}/instruments/${instrumentId}/position`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch position (${res.status})`);
  }
  return res.json();
}

// ─── Portfolio time series ──────────────────────────────────

export type Series = components["schemas"]["SeriesResponse"];
export type Metric = components["schemas"]["Metric"];
export type Mode = components["schemas"]["Mode"];
export type GroupBy = components["schemas"]["GroupBy"];

export interface TimeSeriesQuery {
  metric: Metric;
  start: string;
  end: string;
  granularity: string;
  mode: Mode;
  groupBy?: GroupBy;
  /** Repeated query params, matching FastAPI's native list support —
   * not a comma-joined convention (docs/domain-model.md). */
  instruments?: string[];
  accounts?: string[];
}

export async function fetchTimeSeries(query: TimeSeriesQuery): Promise<Series[]> {
  const params = new URLSearchParams({
    metric: query.metric,
    start: query.start,
    end: query.end,
    granularity: query.granularity,
    mode: query.mode,
    group_by: query.groupBy ?? "none",
  });
  for (const id of query.instruments ?? []) params.append("instruments", id);
  for (const id of query.accounts ?? []) params.append("accounts", id);

  const res = await fetch(`${resolveBase()}/portfolio/query?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Failed to fetch time series (${res.status})`);
  }
  return res.json();
}

// ─── Batched positions ──────────────────────────────────────

export type PositionRow = components["schemas"]["PositionRowResponse"];

export interface PositionsQuery {
  /** Repeated query params, same convention as the time-series query.
   * Omitting a dimension means "no filter" on it. */
  instruments?: string[];
  accounts?: string[];
}

/** Every computed Position across a scope in one call. The client pivots
 * these rows into the Holdings list, the Accounts list and the Grid
 * matrix — see docs/adr/0001-dashboard-v2.md § 5. */
export async function fetchPositions(
  query: PositionsQuery = {},
): Promise<PositionRow[]> {
  const params = new URLSearchParams();
  for (const id of query.instruments ?? []) params.append("instruments", id);
  for (const id of query.accounts ?? []) params.append("accounts", id);

  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(`${resolveBase()}/portfolio/positions${suffix}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Failed to fetch positions (${res.status})`);
  }
  return res.json();
}

// ─── Ledger (Activity feed) ─────────────────────────────────

export type LedgerEntry = components["schemas"]["LedgerEntryResponse"];

export interface LedgerQuery {
  /** Repeated query params, same convention as the positions query. */
  instruments?: string[];
  accounts?: string[];
}

/**
 * Every Transaction in scope, newest first — including the CASH leg
 * auto-posted beside each trade.
 *
 * Those legs arrive carrying their `trade_id` and are filtered out
 * *client-side* by `lib/activity.ts`. That split is deliberate: the
 * suppression rule is a display concern, and a server that pre-filtered
 * would leave the client unable to tell a trade's cash leg from a genuine
 * Deposit at all (docs/adr/0001-dashboard-v2.md § 2).
 */
export async function fetchLedger(
  query: LedgerQuery = {},
): Promise<LedgerEntry[]> {
  const params = new URLSearchParams();
  for (const id of query.instruments ?? []) params.append("instruments", id);
  for (const id of query.accounts ?? []) params.append("accounts", id);

  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(`${resolveBase()}/transactions${suffix}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Failed to fetch transactions (${res.status})`);
  }
  return res.json();
}

// ─── Portfolio summary ──────────────────────────────────────

export type PortfolioSummary =
  components["schemas"]["PortfolioSummaryResponse"];

/** Where the portfolio's history begins. The "Max" range resolves to it;
 * nothing else on the client can derive it (behaviour.md § Ranges and
 * granularity). Null for a portfolio with no transactions at all. */
export async function fetchPortfolioSummary(): Promise<PortfolioSummary> {
  const res = await fetch(`${resolveBase()}/portfolio/summary`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.detail ?? `Failed to fetch portfolio summary (${res.status})`,
    );
  }
  return res.json();
}

// ─── Demo seed ──────────────────────────────────────────────

/** Idempotent — a user who already owns an Account is left alone, so
 * this is safe to call on every launch. */
export async function seedDemoPortfolio(): Promise<{ seeded: boolean }> {
  const res = await fetch(`${resolveBase()}/demo/seed`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to seed demo portfolio (${res.status})`);
  }
  return res.json();
}
