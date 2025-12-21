const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export type Summary = {
  firstBlock: number | null;
  lastIndexedBlock: number | null;
  totalTransfers: number;
  totalWallets: number;

  // ✅ Pair context
  pairAddress?: string;
  pairAddressId?: number | null;

  // ✅ All-time totals (raw + formatted)
  totalBoughtBc400Raw?: string;
  totalSoldBc400Raw?: string;
  totalBoughtBc400?: string; // formatted units string
  totalSoldBc400?: string;   // formatted units string

  // ✅ Counts (support both naming styles)
  totalBuyTransfers?: number;
  totalSellTransfers?: number;
  buyTransfers?: number;
  sellTransfers?: number;
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

// ----------------------
// ✅ NEW TYPES (DEX + LP + Security)
// ----------------------
export type DexPriceResponse = {
  ok: boolean;
  dex?: string;
  token?: string;
  tokenSymbol?: string;
  pair?: string | null;
  reserves?: { token: number; wbnb: number };
  price?: { wbnb: number | null; usd: number | null; wbnbUsdUsed: number | null };
  marketCapUsd?: number | null;
  note?: string | null;
};

export type DexTotalsResponse = {
  pairAddress: string;
  pairAddressId: number | null;
  totalBuys: number;
  totalSells: number;
  totalBoughtRaw: string;
  totalSoldRaw: string;
  note?: string;
};

export type LpLockResponse = {
  ok: boolean;
  pairFound: boolean;
  dex?: string;
  pairAddress?: string;
  burn?: {
    burnedPct: number;
    mode?: string;
    remainingPct?: number;
  };
  heuristic?: {
    mode?: "burned" | "possible-locker" | "verified-locker" | "unverified";
    primaryHolder?: string | null;
    primaryHolderIsContract?: boolean | null;
    note?: string;
  };
  risk?: { label: "LOW" | "MEDIUM" | "HIGH"; note?: string };
  updatedAt?: string;
  reason?: string;
};

export type SecurityRulesResponse = {
  ok: boolean;
  updatedAt?: string;
  rules?: Array<{
    id: string;
    label: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    passed: boolean;
    note?: string;
  }>;
  note?: string;
};

// ----------------------
// Existing fetchers
// ----------------------
export async function fetchSummary(): Promise<Summary> {
  // ✅ Prefer /api/summary since backend exposes both (/summary + /api/summary)
  const res = await fetch(`${API_BASE}/api/summary`);
  if (!res.ok) throw new Error(`Failed to load summary: ${res.status}`);
  return res.json();
}

export async function fetchTopHolders(limit = 20): Promise<TopHoldersResponse> {
  const res = await fetch(`${API_BASE}/top-holders?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load top holders: ${res.status}`);
  return res.json();
}

export async function fetchTransfers(limit = 20): Promise<{ transfers: Transfer[] }> {
  const res = await fetch(`${API_BASE}/transfers?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load transfers: ${res.status}`);
  return res.json();
}

// ----------------------
// ✅ NEW fetchers
// ----------------------
export async function fetchDexPrice(token?: string): Promise<DexPriceResponse> {
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  const res = await fetch(`${API_BASE}/dex/price${qs}`);
  if (!res.ok) throw new Error(`Failed to load dex price: ${res.status}`);
  return res.json();
}

export async function fetchDexTotals(): Promise<DexTotalsResponse> {
  const res = await fetch(`${API_BASE}/api/dex/totals`);
  if (!res.ok) throw new Error(`Failed to load dex totals: ${res.status}`);
  return res.json();
}

export async function fetchLpLock(holder?: string): Promise<LpLockResponse> {
  const qs = holder ? `?holder=${encodeURIComponent(holder)}` : "";
  const res = await fetch(`${API_BASE}/lp/lock${qs}`);
  if (!res.ok) throw new Error(`Failed to load lp lock: ${res.status}`);
  return res.json();
}

export async function fetchSecurityRules(): Promise<SecurityRulesResponse> {
  const res = await fetch(`${API_BASE}/security/rules`);
  if (!res.ok) throw new Error(`Failed to load security rules: ${res.status}`);
  return res.json();
}