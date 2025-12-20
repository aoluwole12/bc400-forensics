import { useEffect, useMemo, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";
import { DailyAuditRoadmap } from "../components/DailyAuditRoadmap";
import StatsGrid, { StatCardData } from "../components/StatsGrid";

// We will reuse the same formatting approach you already have (BigInt-safe, 18dp)
const BC400_DECIMALS = 18;

function toBigIntSafe(input: string): bigint {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (s === "" || s === "-") return 0n;

  const cleaned = s.startsWith("-")
    ? "-" + s.slice(1).replace(/[^\d]/g, "")
    : s.replace(/[^\d]/g, "");

  if (cleaned === "" || cleaned === "-") return 0n;

  try {
    return BigInt(cleaned);
  } catch {
    return 0n;
  }
}

function addCommas(intStr: string): string {
  const neg = intStr.startsWith("-");
  const s = neg ? intStr.slice(1) : intStr;
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg ? `-${out}` : out;
}

function looksRaw18(v: string): boolean {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(s)) return false;
  return s.replace("-", "").length >= 19;
}

function formatFromRaw18(raw: string, maxFrac = 6, minFrac = 2): string {
  const bi = toBigIntSafe(raw);
  const neg = bi < 0n;
  const abs = neg ? -bi : bi;

  const base = 10n ** BigInt(BC400_DECIMALS);
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = addCommas(whole.toString());

  const fracFull = frac.toString().padStart(BC400_DECIMALS, "0");
  let fracCut = fracFull.slice(0, Math.min(maxFrac, BC400_DECIMALS));

  fracCut = fracCut.replace(/0+$/, "");
  while (fracCut.length < minFrac) fracCut += "0";
  if (fracCut.length === 0) fracCut = "0".repeat(minFrac);

  const out = `${wholeStr}.${fracCut}`;
  return neg ? `-${out}` : out;
}

function formatHumanDecimal(input: string, maxFrac = 6, minFrac = 0): string {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (s === "" || s === "-") return "0";

  if (/^-?\d+$/.test(s)) return addCommas(s);

  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const neg = s.startsWith("-");
    const v = neg ? s.slice(1) : s;

    const [w = "0", f = ""] = v.split(".");
    const whole = addCommas((w || "0").replace(/^0+(?=\d)/, "") || "0");

    let frac = (f || "").slice(0, maxFrac);
    frac = frac.replace(/0+$/, "");
    while (frac.length < minFrac) frac += "0";

    return frac.length
      ? `${neg ? "-" : ""}${whole}.${frac}`
      : `${neg ? "-" : ""}${whole}`;
  }

  return input;
}

function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return formatHumanDecimal(String(value), 6, 0);
}

function formatToken(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const s = String(value).trim();

  if (looksRaw18(s)) return formatFromRaw18(s, 6, 2);
  return formatHumanDecimal(s, 6, 2);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

type Summary = {
  firstBlock: number | null;
  lastIndexedBlock: number | null;
  totalTransfers: number;
  totalWallets: number;
};

type Holder = {
  rank: number;
  address: string;
  balance_bc400: string; // fallback human
  balance_raw?: string | null; // preferred raw
};

type Transfer = {
  block_number: number;
  block_time: string | null;
  from_address: string;
  to_address: string;
  amount_bc400: string | null; // fallback human
  amount_raw?: string | null; // preferred raw

  // extra fields (useful later)
  tx_hash?: string | null;
  log_index?: number | null;
};

type LatestCursor = { blockNumber: number; logIndex: number } | null;

type LatestTransfersResponse = {
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
    amount_bc400:
      raw.amount_bc400 ?? raw.amountBC400 ?? raw.amount ?? raw.value ?? null,
    amount_raw:
      raw.raw_amount ?? raw.rawAmount ?? raw.amount_raw ?? raw.rawAmount18 ?? null,
    tx_hash: raw.tx_hash ?? raw.txHash ?? null,
    log_index: raw.log_index ?? raw.logIndex ?? null,
  };
}

function parseISO(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pulls transfers using /transfers/latest cursor pagination until:
 * - we cover at least last 24h (based on oldest row time), OR
 * - we hit maxPages / maxItems safety caps
 */
async function fetchLatestTransfersCovering24h(): Promise<{
  transfers: Transfer[];
  nextCursor: LatestCursor;
}> {
  const limitPerPage = 200;
  const maxPages = 8;     // safety: up to 1600 rows
  const maxItems = 2000;  // safety: hard cap

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

  return { transfers: all, nextCursor: cursor };
}

export default function DailyAuditPage() {
  const [systemOnline, setSystemOnline] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [lastUpdatedISO, setLastUpdatedISO] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [healthRes, summaryRes, holdersRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/summary`),
        fetch(`${API_BASE}/top-holders?limit=50`),
      ]);

      setSystemOnline(healthRes.ok);

      if (summaryRes.ok) setSummary(await summaryRes.json());

      if (holdersRes.ok) {
        const data = await holdersRes.json();
        let raw: any[] = [];
        if (Array.isArray(data)) raw = data;
        else if (Array.isArray(data.holders)) raw = data.holders;
        else if (Array.isArray(data.items)) raw = data.items;
        setHolders(raw.map((h, idx) => normalizeHolder(h, idx)));
      } else {
        setHolders([]);
      }

      // ✅ Latest transfers (cursor, index-backed)
      const latest = await fetchLatestTransfersCovering24h();
      setTransfers(latest.transfers);

      setLastUpdatedISO(new Date().toISOString());
    } catch (e) {
      console.error("Daily audit load failed:", e);
      setSystemOnline(false);
      setSummary(null);
      setHolders([]);
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { last24hTransfers, windowLabel } = useMemo(() => {
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;

    const within = transfers.filter((t) => {
      const d = parseISO(t.block_time);
      if (!d) return false;
      return d.getTime() >= cutoff && d.getTime() <= now;
    });

    return {
      last24hTransfers: within,
      windowLabel: "Last 24H",
    };
  }, [transfers]);

  const metrics = useMemo(() => {
    const walletSet = new Set<string>();
    for (const t of last24hTransfers) {
      if (t.from_address) walletSet.add(t.from_address.toLowerCase());
      if (t.to_address) walletSet.add(t.to_address.toLowerCase());
    }

    let sumRaw = 0n;
    let rawCount = 0;

    for (const t of last24hTransfers) {
      const raw =
        t.amount_raw && String(t.amount_raw).trim() !== "" ? String(t.amount_raw) : null;
      if (raw && /^-?\d+$/.test(raw.replace(/,/g, ""))) {
        sumRaw += toBigIntSafe(raw);
        rawCount++;
      }
    }

    const volumeDisplay = rawCount > 0 ? formatFromRaw18(sumRaw.toString(), 6, 2) : "-";

    const top20 = holders.slice(0, 20);
    const top10 = holders.slice(0, 10);

    let top10Sum = 0n;
    let top20Sum = 0n;
    let okRaw = true;

    for (const h of top10) {
      const raw =
        h.balance_raw && String(h.balance_raw).trim() !== "" ? String(h.balance_raw) : null;
      if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) {
        okRaw = false;
        break;
      }
      top10Sum += toBigIntSafe(raw);
    }

    if (okRaw) {
      for (const h of top20) {
        const raw =
          h.balance_raw && String(h.balance_raw).trim() !== "" ? String(h.balance_raw) : null;
        if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) {
          okRaw = false;
          break;
        }
        top20Sum += toBigIntSafe(raw);
      }
    }

    let top10Concentration = "-";
    if (okRaw && top20Sum > 0n) {
      const pctTimes1000 = (top10Sum * 100000n) / top20Sum;
      const pct = Number(pctTimes1000) / 1000;
      top10Concentration = `${pct.toFixed(1)}%`;
    }

    const topHolderSet = new Set(top20.map((h) => h.address.toLowerCase()));
    let whaleIn = 0n;
    let whaleOut = 0n;
    let whaleRawOk = true;

    for (const t of last24hTransfers) {
      const raw =
        t.amount_raw && String(t.amount_raw).trim() !== "" ? String(t.amount_raw) : null;
      if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) {
        whaleRawOk = false;
        continue;
      }

      const fromIs = topHolderSet.has((t.from_address || "").toLowerCase());
      const toIs = topHolderSet.has((t.to_address || "").toLowerCase());

      if (toIs && !fromIs) whaleIn += toBigIntSafe(raw);
      if (fromIs && !toIs) whaleOut += toBigIntSafe(raw);
    }

    const whaleNet = whaleRawOk
      ? formatFromRaw18((whaleIn - whaleOut).toString(), 6, 2)
      : "0.00";

    return {
      activeWallets: walletSet.size,
      transferVolume: volumeDisplay,
      whaleNetFlow: whaleNet,
      top10Concentration,
    };
  }, [holders, last24hTransfers]);

  const indexedBlock = summary?.lastIndexedBlock ?? null;

  const statusCards: StatCardData[] = [
    {
      id: "report-status",
      label: "Report Status",
      value: systemOnline ? "System Reachable\n(Health OK)" : "System Offline\n(Health Failed)",
    },
    {
      id: "last-updated",
      label: "Last Updated",
      value: lastUpdatedISO ? formatDateTime(lastUpdatedISO) : "-",
    },
    {
      id: "window",
      label: "Transfers Window",
      value: windowLabel,
    },
  ];

  const confidenceCards: StatCardData[] = [
    { id: "active-wallets", label: "Active wallets", value: formatNumber(metrics.activeWallets) },
    { id: "volume", label: "Transfer volume\n(BC400)", value: metrics.transferVolume },
    { id: "total-wallets", label: "Total wallets", value: formatNumber(summary?.totalWallets ?? null) },
    { id: "whale-net", label: "Whale net flow\n(BC400)", value: metrics.whaleNetFlow },
    { id: "top10", label: "Top-10\nconcentration", value: metrics.top10Concentration },
    { id: "indexer", label: "Indexer snapshot", value: indexedBlock ? formatNumber(indexedBlock) : "-" },
  ];

  const whaleCards: StatCardData[] = [
    { id: "whale-net-2", label: "Top holder net flow", value: `${metrics.whaleNetFlow} BC400` },
  ];

  const holderCards: StatCardData[] = [
    { id: "active-wallets-2", label: "Active wallets", value: formatNumber(metrics.activeWallets) },
    { id: "total-wallets-2", label: "Total wallets now", value: formatNumber(summary?.totalWallets ?? null) },
  ];

  return (
    <div className="app-root">
      <div className="app-shell">
        <Header />

        {/* Status */}
        <section className="panel panel--status">
          <div className="panel-block">
            <div className="panel-header-row">
              <h2 className="panel-title">Daily BC400 Audit Report</h2>
            </div>

            <p className="panel-muted">
              Live recap derived from your existing API: <b>/health</b>, <b>/summary</b>,{" "}
              <b>/top-holders</b>, <b>/transfers/latest</b>
            </p>

            <div style={{ marginTop: 12 }}>
              <StatsGrid stats={statusCards} />
            </div>
          </div>

          {/* ✅ Right: ONLY these buttons now */}
          <div className="daily-audit-actions">
            <button
              type="button"
              className="pill-action-btn"
              onClick={() => window.history.back()}
            >
              ← Back to dashboard
            </button>

            <button
              type="button"
              className="pill-action-btn"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>
        </section>

        {/* Confidence / Signals */}
        <section className="panel panel--table">
          <div className="panel-header-row">
            <h2 className="panel-title">Confidence Signals</h2>
            <span className="panel-caption">{systemOnline ? "API Online" : "API Offline"}</span>
          </div>

          <div style={{ marginTop: 8 }}>
            <StatsGrid stats={confidenceCards} />
          </div>

          <div style={{ marginTop: 14 }}>
            <DailyAuditRoadmap />
          </div>
        </section>

        {/* Liquidity */}
        <section className="panel panel--table">
          <div className="panel-header-row">
            <h2 className="panel-title">Liquidity</h2>
            <span className="panel-caption">Not yet available from current endpoints</span>
          </div>

          <div className="panel-muted">
            <b>LP lock:</b> not yet available from current endpoints
            <div style={{ marginTop: 6 }}>
              To make this investor-grade, we’ll add on-chain DEX pair detection + locker detection
              (PinkLock/Unicrypt/TeamFinance, etc) then show:
              <ul>
                <li>Pair address + DEX (PancakeSwap v2/v3) + reserves</li>
                <li>LP lock %, unlock date(s), and locker contract verification</li>
                <li>Alerts on unlocks, liquidity pulls, ownership changes</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Whale Activity */}
        <section className="panel panel--table">
          <div className="panel-header-row">
            <h2 className="panel-title">Whale Activity</h2>
            <span className="panel-caption">Based on top-holders + transfers (Last 24h)</span>
          </div>

          <div style={{ marginTop: 8 }}>
            <StatsGrid stats={whaleCards} />
          </div>
        </section>

        {/* Holder / Wallet Activity */}
        <section className="panel panel--table">
          <div className="panel-header-row">
            <h2 className="panel-title">Holder / Wallet Activity</h2>
            <span className="panel-caption">Last 24h</span>
          </div>

          <div style={{ marginTop: 8 }}>
            <StatsGrid stats={holderCards} />
          </div>

          <div className="panel-muted" style={{ marginTop: 10 }}>
            Now using <b>/transfers/latest</b> (cursor pagination) instead of pulling 2000 rows from <b>/transfers</b>.
          </div>
        </section>
      </div>
    </div>
  );
}
