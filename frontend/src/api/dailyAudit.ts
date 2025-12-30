// frontend/src/api/dailyAudit.ts
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

/** =========================
 * Existing types (kept)
 * ========================= */
export type Summary = {
  firstBlock: number | null;
  lastIndexedBlock: number | null;
  totalTransfers: number;
  totalWallets: number;
};

export type Holder = {
  rank: number;
  address: string;
  balance_bc400: string;
  balance_raw?: string | null;
};

export type LatestCursor = { blockNumber: number; logIndex: number } | null;

export type LatestTransfersResponse = {
  items: Array<{
    tx_hash: string;
    log_index: number;
    block_number: number;
    block_time: string | null;
    from_address: string;
    to_address: string;
    raw_amount: string;
  }>;
  nextCursor: LatestCursor;
};

export type DexPrice = {
  ok: boolean;
  dex?: string;
  pairAddress?: string;
  token?: string;
  tokenSymbol?: string;
  priceWbnb?: string | number;
  priceUsd?: string | number | null;
  marketCapUsd?: string | number | null;
  updatedAt?: string;
  reason?: string;
  note?: string;
};

export type LpLock = {
  ok: boolean;
  pairFound?: boolean;
  dex?: string;
  pairAddress?: string;
  expectedPairAddress?: string | null;
  warnings?: string[];
  burn?: { burnedPct?: number };
  updatedAt?: string;
  reason?: string;
};

export type TokenBurn = {
  ok: boolean;
  tokenAddress?: string;
  token?: { symbol?: string; decimals?: number };
  supply?: {
    totalSupplyRaw?: string;
    burnedRaw?: string;
    circulatingRaw?: string;
    burnedPct?: number;
  };
  burnWallets?: { dead?: string; zero?: string };
  updatedAt?: string;
  reason?: string;
};

export type DexTotals = {
  pairAddress: string;
  pairAddressId: number | null;
  totalBuys: number;
  totalSells: number;
  totalBoughtRaw: string;
  totalSoldRaw: string;
  definitions?: any;
  note?: string;
};

export type Transfer = {
  block_number: number;
  block_time: string | null;
  from_address: string;
  to_address: string;
  amount_raw?: string | null;
  tx_hash?: string | null;
  log_index?: number | null;
};

/** =========================
 * NEW: /api/daily-audit response types
 * ========================= */
export type DailyAuditAdjusted = {
  excluded?: Array<{ address: string }>;
  excludedBalanceRaw?: string | number | null;
  trueCirculatingRaw?: string | number | null;
  top10PctTrueCirculating?: string | number | null;
  effectiveConcentrationPctTrue?: string | number | null;
  effectiveHoldersTrue?: string | number | null;
};

export type DailyAuditResponse = {
  generatedAt?: string;

  window?: { label?: string; start?: string; end?: string };

  chain?: {
    lastIndexedBlock?: number | null;
    lastIndexedTime?: string | null;
  };

  transfers?: {
    txs24h?: number | null;
    txs6h?: number | null;
    txs1h?: number | null;
    activeWallets24h?: number | null;
    recent?: Array<{
      blockNumber?: number;
      blockTime?: string | null;
      txHash?: string | null;
      logIndex?: number | null;
      from?: string;
      to?: string;
      rawAmount?: string | null;
    }>;
  };

  supply?: {
    snapshotTime?: string | null;

    totalSupplyRaw?: string | null;
    burnedRaw?: string | null;
    lpRaw?: string | null;
    lockedRaw?: string | null;
    circulatingRaw?: string | null;

    decimals?: number | null;
    totalSupply?: number | string | null;
    circulatingSupply?: number | string | null;

    priceUsd?: number | string | null;

    // ✅ new backend meaning: real circulating market cap
    marketCapUsd?: number | string | null;

    // ✅ FDV (old stored market cap)
    fdvUsd?: number | string | null;

    // back-compat key from backend
    marketcapUsdLegacy?: number | string | null;

    metadata?: any;

    flags?: {
      missing?: boolean;
      allZero?: boolean;
      inconsistent?: boolean;
    };
  };

  holders?: {
    top10?: { sumRaw?: string | number | null; sumBc400?: string | number | null };
  };

  concentration?: {
    fromTable?: any;
    derived?: { top10PctOfCirculating?: number | null };
  };

  concentrationAdjusted?: DailyAuditAdjusted;

  risk?: { latest?: any };
};

/** =========================
 * Bundle returned to UI
 * ========================= */
export type DailyAuditBundle = {
  systemOnline: boolean;
  summary: Summary | null;
  holders: Holder[];
  transfers24h: Transfer[];
  transfers24hCount: number;
  lastUpdatedISO: string;

  dexPrice: DexPrice | null;
  lpLock: LpLock | null;
  tokenBurn: TokenBurn | null;

  dexTotals?: DexTotals | null;

  /** ✅ NEW: raw daily-audit payload (for Investor Snapshot adjusted cards) */
  dailyAudit?: DailyAuditResponse | null;
};

async function fetchJson<T>(
  path: string
): Promise<
  | { status: "ok"; data: T }
  | { status: "missing" }
  | { status: "error"; message: string }
> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (res.status === 404) return { status: "missing" };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return { status: "ok", data: (await res.json()) as T };
  } catch (e: any) {
    return { status: "error", message: e?.message || String(e) };
  }
}

function normalizeHolder(raw: any, index: number): Holder {
  return {
    rank: raw.rank ?? raw.position ?? raw.index ?? index + 1,
    address: raw.address ?? raw.wallet ?? "",
    balance_bc400: raw.balance_bc400 ?? raw.balanceBC400 ?? raw.balance ?? "0",
    balance_raw: raw.balanceRaw ?? raw.balance_raw ?? raw.balance_raw_18 ?? null,
  };
}

function normalizeTransfer(raw: any): Transfer {
  return {
    block_number: raw.block_number ?? raw.blockNumber ?? 0,
    block_time: raw.block_time ?? raw.blockTime ?? raw.time ?? null,
    from_address: raw.from_address ?? raw.fromAddress ?? raw.from ?? "",
    to_address: raw.to_address ?? raw.toAddress ?? raw.to ?? "",
    amount_raw: raw.raw_amount ?? raw.rawAmount ?? raw.amount_raw ?? null,
    tx_hash: raw.tx_hash ?? raw.txHash ?? null,
    log_index: raw.log_index ?? raw.logIndex ?? null,
  };
}

// Daily-audit "recent" transfer normalization
function normalizeAuditRecent(raw: any): Transfer {
  return {
    block_number: raw.blockNumber ?? raw.block_number ?? 0,
    block_time: raw.blockTime ?? raw.block_time ?? null,
    from_address: raw.from ?? raw.from_address ?? "",
    to_address: raw.to ?? raw.to_address ?? "",
    amount_raw: raw.rawAmount ?? raw.raw_amount ?? null,
    tx_hash: raw.txHash ?? raw.tx_hash ?? null,
    log_index: raw.logIndex ?? raw.log_index ?? null,
  };
}

function parseISO(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function fetchLatestTransfersCovering24h(): Promise<{
  transfers: Transfer[];
  nextCursor: LatestCursor;
  count24h: number;
}> {
  const limitPerPage = 200;
  const maxPages = 8;
  const maxItems = 2000;

  let all: Transfer[] = [];
  let cursor: LatestCursor = null;

  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${API_BASE}/transfers/latest`);
    url.searchParams.set("limit", String(limitPerPage));
    if (cursor) {
      url.searchParams.set("cursorBlock", String(cursor.blockNumber));
      url.searchParams.set("cursorLog", String(cursor.logIndex));
    }

    const res = await fetch(url.toString());
    if (!res.ok) break;

    const data = (await res.json()) as LatestTransfersResponse;
    const pageTransfers = (data.items || []).map((t) => normalizeTransfer(t));

    all = all.concat(pageTransfers);
    cursor = data.nextCursor ?? null;

    if (pageTransfers.length === 0 || !cursor) break;
    if (all.length >= maxItems) break;

    const oldest = all[all.length - 1];
    const oldestTime = parseISO(oldest.block_time)?.getTime() ?? null;
    if (oldestTime !== null && oldestTime < cutoff) break;
  }

  const transfers24h = all.filter((t) => {
    const d = parseISO(t.block_time);
    if (!d) return false;
    const ts = d.getTime();
    return ts >= cutoff && ts <= now;
  });

  return { transfers: all, nextCursor: cursor, count24h: transfers24h.length };
}

/** ✅ NEW: fetch /api/daily-audit (preferred) */
export async function fetchDailyAuditRaw(): Promise<DailyAuditResponse | null> {
  // try /api/daily-audit first, then /daily-audit for back-compat
  const a = await fetchJson<DailyAuditResponse>("/api/daily-audit");
  if (a.status === "ok") return a.data;

  const b = await fetchJson<DailyAuditResponse>("/daily-audit");
  if (b.status === "ok") return b.data;

  return null;
}

function toNumberMaybe(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function fetchDailyAuditBundle(opts?: { includeDexTotals?: boolean }): Promise<DailyAuditBundle> {
  // Pull daily audit FIRST (this is what powers the "Adjusted" cards)
  const dailyAudit = await fetchDailyAuditRaw();

  // Keep old data sources too (so nothing breaks)
  const [healthRes, summaryRes, holdersRes] = await Promise.all([
    fetch(`${API_BASE}/health`).catch(() => null),
    fetchJson<Summary>("/summary"),
    fetchJson<any>("/top-holders?limit=50"),
  ]);

  const systemOnline = !!healthRes?.ok;
  const summary = summaryRes.status === "ok" ? summaryRes.data : null;

  let holders: Holder[] = [];
  if (holdersRes.status === "ok") {
    const data = holdersRes.data;
    let raw: any[] = [];
    if (Array.isArray(data)) raw = data;
    else if (Array.isArray((data as any).holders)) raw = (data as any).holders;
    else if (Array.isArray((data as any).items)) raw = (data as any).items;
    holders = raw.map((h, idx) => normalizeHolder(h, idx));
  }

  // Transfers for the UI:
  // Prefer daily-audit recent transfers (already limited + sorted),
  // fallback to your /transfers/latest pagination.
  let transfers24h: Transfer[] = [];
  let transfers24hCount = 0;

  if (dailyAudit?.transfers?.recent && Array.isArray(dailyAudit.transfers.recent)) {
    transfers24h = dailyAudit.transfers.recent.map((t) => normalizeAuditRecent(t));
    transfers24hCount = Number(dailyAudit.transfers.txs24h ?? transfers24h.length ?? 0);
  } else {
    const latest = await fetchLatestTransfersCovering24h();
    transfers24h = latest.transfers;
    transfers24hCount = latest.count24h;
  }

  // Keep your existing endpoints
  const [dexRes, lpRes, tokenRes] = await Promise.all([
    fetchJson<DexPrice>("/dex/price"),
    fetchJson<LpLock>("/lp/lock"),
    fetchJson<TokenBurn>("/token/burn"),
  ]);

  let dexPrice = dexRes.status === "ok" ? dexRes.data : null;
  const lpLock = lpRes.status === "ok" ? lpRes.data : null;
  const tokenBurn = tokenRes.status === "ok" ? tokenRes.data : null;

  // ✅ If /dex/price is missing or partial, fill key values from daily-audit supply
  if (dailyAudit?.supply) {
    const priceUsd = toNumberMaybe(dailyAudit.supply.priceUsd);
    const marketCapUsd = toNumberMaybe(dailyAudit.supply.marketCapUsd);

    if (!dexPrice) {
      dexPrice = {
        ok: true,
        priceUsd: priceUsd ?? null,
        marketCapUsd: marketCapUsd ?? null,
        updatedAt: dailyAudit.generatedAt,
        note: "filled from /daily-audit supply",
      };
    } else {
      if (dexPrice.priceUsd == null && priceUsd != null) dexPrice.priceUsd = priceUsd;
      if (dexPrice.marketCapUsd == null && marketCapUsd != null) dexPrice.marketCapUsd = marketCapUsd;
    }
  }

  let dexTotals: DexTotals | null | undefined = undefined;
  if (opts?.includeDexTotals) {
    const totalsRes = await fetchJson<DexTotals>("/dex/totals");
    dexTotals = totalsRes.status === "ok" ? totalsRes.data : null;
  }

  return {
    systemOnline,
    summary,
    holders,
    transfers24h,
    transfers24hCount,
    lastUpdatedISO: new Date().toISOString(),
    dexPrice,
    lpLock,
    tokenBurn,
    dexTotals,

    // ✅ NEW: raw daily-audit payload for the "Adjusted" Investor Snapshot cards
    dailyAudit,
  };
}