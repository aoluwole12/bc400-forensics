// src/api.ts
// Frontend helper for talking to the BC400 backend API

export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"
).replace(/\/+$/, "");

// -------- Types --------

export type Summary = {
  firstBlock: number | null;
  lastIndexedBlock: number | null;
  totalTransfers: number;
  totalWallets: number;
};

export type Holder = {
  rank: number;
  addressId: number;
  address: string;
  balanceBc400: string;
  balanceRaw: string;
  firstSeen: string;
  lastSeen: string;
  txCount: number;
  lastBlockNumber: number | null;
  lastBlockTime: string | null;
  lastTxHash: string | null;
  tags: string[];
};

export type Transfer = {
  blockNumber: number;
  blockTime: string | null;
  txHash: string;
  fromAddress: string | null;
  toAddress: string | null;
  rawAmount: string;
};

export type SqlResult = {
  rowCount: number;
  rows: Record<string, unknown>[];
  fields: string[];
};

type ApiErrorShape = {
  error?: string;
  details?: string;
};

// -------- Internal helper --------

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorShape;
      if (body.error || body.details) {
        message = `${body.error ?? "Error"}${
          body.details ? `: ${body.details}` : ""
        }`;
      }
    } catch {
      // body not JSON, ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// -------- Public API calls --------

export async function fetchHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  return handleResponse<{ ok: boolean }>(res);
}

export async function fetchSummary(): Promise<Summary> {
  const res = await fetch(`${API_BASE}/summary`);
  return handleResponse<Summary>(res);
}

export async function fetchTopHolders(limit = 100): Promise<Holder[]> {
  const url = new URL(`${API_BASE}/top-holders`);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString());
  const data = await handleResponse<{ holders: Holder[] }>(res);
  return data.holders;
}

export async function fetchRecentTransfers(
  limit = 200,
): Promise<Transfer[]> {
  const url = new URL(`${API_BASE}/transfers`);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString());
  const data = await handleResponse<{ transfers: Transfer[] }>(res);
  return data.transfers;
}

export async function runSql(sql: string): Promise<SqlResult> {
  const res = await fetch(`${API_BASE}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  return handleResponse<SqlResult>(res);
}
