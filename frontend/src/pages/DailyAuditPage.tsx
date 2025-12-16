import React, { useEffect, useMemo, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";
import { useNavigate } from "react-router-dom";
import { SignalBadge } from "../components/SignalBadge";
import { DailyAuditRoadmap } from "../components/DailyAuditRoadmap";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

type Summary = {
  firstBlock: number;
  lastIndexedBlock: number;
  totalTransfers: number;
  totalWallets: number;
};

type Holder = {
  rank: number;
  address: string;
  balance_bc400: string; // may be human OR raw depending on backend field mapping
};

type Transfer = {
  block_time: string | null;
  from_address: string;
  to_address: string;
  amount_bc400: string | null; // may be human OR raw depending on backend field mapping
};

function normalizeHolder(raw: any, index: number): Holder {
  return {
    rank: raw.rank ?? raw.position ?? raw.index ?? index + 1,
    address: raw.address ?? raw.wallet ?? "",
    // NOTE: may come as human OR raw — we handle both safely below
    balance_bc400: raw.balance_bc400 ?? raw.balance ?? raw.balanceRaw ?? "0",
  };
}

function normalizeTransfer(raw: any): Transfer {
  return {
    block_time: raw.block_time ?? raw.blockTime ?? raw.time ?? null,
    from_address: raw.from_address ?? raw.fromAddress ?? raw.from ?? "",
    to_address: raw.to_address ?? raw.toAddress ?? raw.to ?? "",
    // NOTE: may come as human OR raw — we handle both safely below
    amount_bc400:
      raw.amount_bc400 ??
      raw.amount ??
      raw.value ??
      raw.raw_amount ??
      raw.rawAmount ??
      null,
  };
}

/**
 * Safe BigInt parser for numeric strings.
 * Strips commas/spaces, allows leading '-'.
 */
function toBigIntSafe(input: string): bigint {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (s === "") return 0n;

  // Keep only digits, with optional leading '-'
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

/**
 * Decide if a string looks like "raw units" (18 decimals implied).
 * Heuristic: integer-only and very long.
 */
function looksRaw18(v: string): boolean {
  const s = String(v ?? "").trim().replace(/,/g, "");
  return /^-?\d+$/.test(s) && s.replace("-", "").length > 18;
}

/**
 * Convert raw integer (string) with 18 decimals into a formatted human string:
 * - commas on whole part
 * - up to maxFrac decimals (trim trailing zeros)
 */
function formatFromRaw18(raw: string, maxFrac = 6): string {
  const bi = toBigIntSafe(raw);
  const neg = bi < 0n;
  const abs = neg ? -bi : bi;

  const base = 10n ** 18n;
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let fracStr = frac.toString().padStart(18, "0").slice(0, Math.max(0, maxFrac));

  // trim trailing zeros
  fracStr = fracStr.replace(/0+$/, "");
  const out =
    fracStr.length > 0 ? `${wholeStr}.${fracStr}` : wholeStr;

  return neg ? `-${out}` : out;
}

/**
 * Format a human decimal string (already scaled) with commas + up to 6 decimals.
 */
function formatHumanDecimal(input: string, maxFrac = 6): string {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (s === "" || s === "-") return "0";

  // If it’s actually raw, format as raw
  if (looksRaw18(s)) return formatFromRaw18(s, maxFrac);

  const n = Number(s);
  if (!Number.isFinite(n)) return s;

  return n.toLocaleString(undefined, {
    maximumFractionDigits: maxFrac,
  });
}

/**
 * For math inside the page, we need a numeric value.
 * We compute in "micro-BC400" (1e-6) using BigInt to avoid float issues.
 *
 * - If value is raw (18dp): convert to micro by dividing by 1e12.
 * - If value is human decimal: parse as Number and convert to micro.
 */
function toMicroBc400(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;

  const s = String(v).trim().replace(/,/g, "");
  if (s === "" || s === "-") return 0n;

  // Raw 18dp integer case
  if (looksRaw18(s)) {
    const raw = toBigIntSafe(s);
    // micro = raw / 1e12 (because 18dp -> 6dp)
    return raw / (10n ** 12n);
  }

  // Human decimal case
  const num = Number(s);
  if (!Number.isFinite(num)) return 0n;
  return BigInt(Math.trunc(num * 1e6));
}

/**
 * Turn micro-BC400 BigInt into a human display string with commas and 2–6 decimals.
 */
function formatMicroBc400(micro: bigint, maxFrac = 6, minFrac = 2): string {
  const neg = micro < 0n;
  const abs = neg ? -micro : micro;

  const base = 1_000_000n;
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let fracStr = frac.toString().padStart(6, "0");

  // clamp to maxFrac (<=6)
  const cut = Math.max(0, Math.min(6, maxFrac));
  fracStr = fracStr.slice(0, cut);

  // trim trailing zeros but keep at least minFrac
  fracStr = fracStr.replace(/0+$/, "");
  while (fracStr.length < Math.max(0, Math.min(cut, minFrac))) fracStr += "0";

  const out = fracStr.length ? `${wholeStr}.${fracStr}` : wholeStr;
  return neg ? `-${out}` : out;
}

function formatCompactFromMicro(micro: bigint): string {
  // For compact “K/M/B” display we convert to Number safely only when small enough.
  // If huge, just show full formatted value.
  const abs = micro < 0n ? -micro : micro;

  // If abs > 9e15 micro (~9e9 BC400), Number can still handle, but keep safe:
  if (abs > 9_000_000_000_000_000n) {
    return formatMicroBc400(micro, 2, 2);
  }

  const num = Number(micro) / 1e6; // BC400 as float for compact
  if (!Number.isFinite(num)) return "-";

  const a = Math.abs(num);
  if (a >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (num / 1e3).toFixed(2) + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatSignedFromMicro(micro: bigint): string {
  const sign = micro > 0n ? "+" : micro < 0n ? "−" : "";
  const abs = micro < 0n ? -micro : micro;
  return sign + formatCompactFromMicro(abs);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const DailyAuditPage: React.FC = () => {
  const navigate = useNavigate();

  const [healthOk, setHealthOk] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    try {
      setLoading(true);
      setError(null);

      const [healthRes, summaryRes, holdersRes, transfersRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/summary`),
        fetch(`${API_BASE}/top-holders`),
        fetch(`${API_BASE}/transfers`),
      ]);

      setHealthOk(healthRes.ok);

      if (summaryRes.ok) setSummary(await summaryRes.json());

      if (holdersRes.ok) {
        const data = await holdersRes.json();
        let raw: any[] = [];
        if (Array.isArray(data)) raw = data;
        else if (Array.isArray(data.holders)) raw = data.holders;
        else if (Array.isArray(data.items)) raw = data.items;
        setHolders(raw.map((h, i) => normalizeHolder(h, i)));
      }

      if (transfersRes.ok) {
        const data = await transfersRes.json();
        let raw: any[] = [];
        if (Array.isArray(data)) raw = data;
        else if (Array.isArray(data.transfers)) raw = data.transfers;
        else if (Array.isArray(data.items)) raw = data.items;
        setTransfers(raw.map((t) => normalizeTransfer(t)));
      }

      setLastUpdated(new Date().toISOString());
    } catch (e) {
      console.error(e);
      setError("Could not load live audit data from the API base.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const audit = useMemo(() => {
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;

    const transfersWithTime = transfers.filter((t) => t.block_time);
    const hasTimestamps = transfersWithTime.length > 0;

    const last24h = hasTimestamps
      ? transfersWithTime.filter((t) => {
          const ms = new Date(t.block_time as string).getTime();
          return Number.isFinite(ms) && ms >= cutoff;
        })
      : transfers.slice(0, 250); // fallback (still live, but not 24h-true)

    const activeWalletsSet = new Set<string>();
    let volume24hMicro = 0n;

    for (const t of last24h) {
      if (t.from_address) activeWalletsSet.add(t.from_address.toLowerCase());
      if (t.to_address) activeWalletsSet.add(t.to_address.toLowerCase());
      volume24hMicro += toMicroBc400(t.amount_bc400);
    }

    const top20 = holders.slice(0, 20);
    const top10 = holders.slice(0, 10);

    const totalTop20Micro = top20.reduce((acc, h) => acc + toMicroBc400(h.balance_bc400), 0n);
    const totalTop10Micro = top10.reduce((acc, h) => acc + toMicroBc400(h.balance_bc400), 0n);

    const topSet = new Set(top20.map((h) => h.address.toLowerCase()));

    let inflowMicro = 0n;
    let outflowMicro = 0n;

    for (const t of last24h) {
      const fromTop = topSet.has((t.from_address || "").toLowerCase());
      const toTop = topSet.has((t.to_address || "").toLowerCase());
      const amtMicro = toMicroBc400(t.amount_bc400);

      if (toTop && !fromTop) inflowMicro += amtMicro;
      if (fromTop && !toTop) outflowMicro += amtMicro;
    }

    const whaleNetMicro = inflowMicro - outflowMicro;

    // concentration (%) with BigInt micro precision (avoid float explosion)
    let top10Concentration: number | null = null;
    if (totalTop20Micro > 0n) {
      // scale to 1 decimal using integer math: (top10/totalTop20)*1000 -> /10
      const pctTimes10 = Number((totalTop10Micro * 1000n) / totalTop20Micro) / 10;
      top10Concentration = Number.isFinite(pctTimes10) ? pctTimes10 : null;
    }

    const indexLag = summary ? Math.max(0, summary.lastIndexedBlock - summary.firstBlock) : 0;

    return {
      hasTimestamps,
      transfersWindowLabel: hasTimestamps ? "last 24h" : "latest 250 transfers (timestamps missing)",
      activeWallets24h: activeWalletsSet.size,
      volume24hMicro,
      top10Concentration,
      whaleNetMicro,
      inflowMicro,
      outflowMicro,
      indexLag,
    };
  }, [holders, transfers, summary]);

  const reportStatusTone = error ? "bad" : healthOk ? "ok" : "warn";

  const reportStatusText = error
    ? "API not reachable"
    : healthOk
    ? "System reachable (health OK)"
    : "Health not OK";

  const updatedText = lastUpdated ? fmtTime(lastUpdated) : "-";

  return (
    <div className="app-root">
      <div className="app-shell">
        <Header />

        <section className="panel audit-panel">
          <div className="audit-topbar">
            <div className="audit-head">
              <h2 className="audit-title">Daily BC400 Audit Report</h2>
              <p className="audit-subtitle">
                Live recap derived from your existing API: <b>/health</b>, <b>/summary</b>, <b>/top-holders</b>, <b>/transfers</b>
              </p>
            </div>

            <div className="audit-actions">
              <button type="button" className="audit-btn" onClick={() => navigate("/")}>
                ← Back to dashboard
              </button>
              <button type="button" className="audit-btn audit-btn--primary" onClick={loadAll} disabled={loading}>
                ⟳ Refresh
              </button>
            </div>
          </div>

          <div className="audit-badges">
            <SignalBadge
              label="Report Status"
              value={loading ? "Loading…" : reportStatusText}
              tone={reportStatusTone as any}
              hint="Backed by /health and live API calls."
            />
            <SignalBadge label="Last updated" value={loading ? "…" : updatedText} tone="neutral" />
            <SignalBadge
              label="Transfers window"
              value={audit.transfersWindowLabel}
              tone={audit.hasTimestamps ? "ok" : "warn"}
              hint={audit.hasTimestamps ? "True 24h window (block_time present)." : "Fallback window used because timestamps are missing."}
            />
          </div>

          {error && <div className="audit-error">Error: {error}</div>}

          <div className="audit-hero">
            <div className="audit-hero-left">
              <div className="audit-hero-title">Confidence Signals</div>
              <div className="audit-hero-grid">
                <div className="audit-metric">
                  <div className="audit-metric-label">Active wallets</div>
                  <div className="audit-metric-value">{formatCompactFromMicro(BigInt(audit.activeWallets24h) * 1_000_000n)}</div>
                  <div className="audit-metric-note">Unique wallets seen in {audit.transfersWindowLabel}.</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Transfer volume (BC400)</div>
                  <div className="audit-metric-value">{formatCompactFromMicro(audit.volume24hMicro)}</div>
                  <div className="audit-metric-note">Sum of transfer amounts in {audit.transfersWindowLabel}.</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Total wallets</div>
                  <div className="audit-metric-value">{summary ? formatHumanDecimal(String(summary.totalWallets), 0) : "-"}</div>
                  <div className="audit-metric-note">From /summary (indexed wallets).</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Whale net flow (BC400)</div>
                  <div className="audit-metric-value">{formatSignedFromMicro(audit.whaleNetMicro)}</div>
                  <div className="audit-metric-note">Proxy from last transfers involving top holders (in − out).</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Top-10 concentration</div>
                  <div className="audit-metric-value">
                    {audit.top10Concentration === null ? "-" : `${audit.top10Concentration.toFixed(1)}%`}
                  </div>
                  <div className="audit-metric-note">Share of top10 vs top20 balances.</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Indexer snapshot</div>
                  <div className="audit-metric-value">{summary ? formatHumanDecimal(String(summary.lastIndexedBlock), 0) : "-"}</div>
                  <div className="audit-metric-note">Last indexed block from /summary.</div>
                </div>
              </div>
            </div>

            <div className="audit-hero-right">
              <DailyAuditRoadmap />
            </div>
          </div>

          <div className="audit-section">
            <h3 className="audit-section-title">Liquidity</h3>
            <div className="audit-section-body">
              <div className="audit-callout audit-callout--warn">
                <div className="audit-callout-title">LP lock: not yet available from current endpoints</div>
                <div className="audit-callout-text">
                  To make this investor-grade, we’ll add on-chain DEX pair detection + locker detection (PinkLock/Unicrypt/TeamFinance/own lockers) and then show:
                  <ul className="audit-list">
                    <li>Pair address + DEX (PancakeSwap v2/v3) + reserves</li>
                    <li>LP lock %, unlock date(s), and locker contract verification</li>
                    <li>Alerts on unlocks, liquidity pulls, ownership changes</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="audit-section">
            <h3 className="audit-section-title">Whale Activity</h3>
            <div className="audit-section-body">
              <div className="audit-line">
                <span className="audit-k">Top holder net flow:</span>
                <span className="audit-v">{formatSignedFromMicro(audit.whaleNetMicro)} BC400</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Inflow to top holders:</span>
                <span className="audit-v">{formatCompactFromMicro(audit.inflowMicro)} BC400</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Outflow from top holders:</span>
                <span className="audit-v">{formatCompactFromMicro(audit.outflowMicro)} BC400</span>
              </div>
              <div className="audit-muted">
                Computed from <b>/top-holders</b> (top 20) + <b>/transfers</b> ({audit.transfersWindowLabel}).
              </div>
            </div>
          </div>

          <div className="audit-section">
            <h3 className="audit-section-title">Holder / Wallet Activity</h3>
            <div className="audit-section-body">
              <div className="audit-line">
                <span className="audit-k">Active wallets:</span>
                <span className="audit-v">{formatHumanDecimal(String(audit.activeWallets24h), 0)}</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Total wallets now:</span>
                <span className="audit-v">{summary ? formatHumanDecimal(String(summary.totalWallets), 0) : "-"}</span>
              </div>
              <div className="audit-muted">
                Investors love trend-lines. Next step is a small backend endpoint that stores daily snapshots so we can chart growth.
              </div>
            </div>
          </div>

          <div className="audit-footer-note">
            This page is <b>live</b> right now because it uses your existing endpoints only — no new backend route required.
          </div>
        </section>
      </div>
    </div>
  );
};