const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

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
  blockTime: string;
  txHash: string;
  fromAddress: string | null;
  toAddress: string | null;
  rawAmount: string;
};

export type TopHoldersResponse = {
  snapshotUpdatedAt: string | null;
  holders: Holder[];
};

export async function fetchSummary(): Promise<Summary> {
  const res = await fetch(`${API_BASE}/summary`);
  if (!res.ok) {
    throw new Error(`Failed to load summary: ${res.status}`);
  }
  return res.json();
}

export async function fetchTopHolders(
  limit = 20,
): Promise<TopHoldersResponse> {
  const res = await fetch(`${API_BASE}/top-holders?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to load top holders: ${res.status}`);
  }
  return res.json();
}

export async function fetchTransfers(
  limit = 20,
): Promise<{ transfers: Transfer[] }> {
  const res = await fetch(`${API_BASE}/transfers?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to load transfers: ${res.status}`);
  }
  return res.json();
}