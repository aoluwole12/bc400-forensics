import React, { useEffect, useMemo, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";
import { useNavigate } from "react-router-dom";
import { SignalBadge } from "../components/SignalBadge";
import { DailyAuditRoadmap } from "../components/DailyAuditRoadmap";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const TOKEN_DECIMALS = 18;

type Summary = {
  firstBlock: number;
  lastIndexedBlock: number;
  totalTransfers: number;
  totalWallets: number;
};

type Holder = {
  rank: number;
  address: string;
  balance_bc400: string; // fallback human (may be raw depending on endpoint)
  balance_raw?: string | null; // preferred raw (18dp) if present
};

type Transfer = {
  block_time: string | null;
  from_address: string;
  to_address: string;
  amount_bc400: string | null; // fallback human (may be raw depending on endpoint)
  amount_raw?: string | null;  // preferred raw (18dp) if present
};

function normalizeHolder(raw: any, index: number): Holder {
  return {
    rank: raw.rank ?? raw.position ?? raw.index ?? index + 1,
    address: raw.address ?? raw.wallet ?? "",
    balance_bc400:
      raw.balance_bc400 ??
      raw.balanceBC400 ??
      raw.balance ??
      raw.balanceRaw ??
      raw.balance_raw ??
      "0",
    balance_raw: raw.balance_raw ?? raw.balanceRaw ?? null,
  };
}

function normalizeTransfer(raw: any): Transfer {
  return {
    block_time:
      raw.block_time ??
      raw.blockTime ??
      raw.time ??
      raw.block_time_iso ??
      raw.blockTimeIso ??
      null,
    from_address: raw.from_address ?? raw.fromAddress ?? raw.from ?? "",
    to_address: raw.to_address ?? raw.toAddress ?? raw.to ?? "",
    amount_bc400:
      raw.amount_bc400 ??
      raw.amountBC400 ??
      raw.amount ??
      raw.value ??
      raw.raw_amount ??
      raw.rawAmount ??
      null,
    amount_raw: raw.raw_amount ?? raw.rawAmount ?? null,
  };
}

/**
 * ✅ Best-practice token picker:
 * Always prefer raw if present; fall back to human.
 */
function pickTokenValue(raw?: string | null, human?: string | null): string | null {
  const r = raw !== undefined && raw !== null && String(raw).trim() !== "" ? String(raw).trim() : null;
  if (r) return r;
  const h = human !== undefined && human !== null && String(human).trim() !== "" ? String(human).trim() : null;
  return h;
}

/**
 * Convert possibly-raw integer string into a human decimal string using TOKEN_DECIMALS.
 * - If value already contains ".", we assume it's already human-readable and keep it.
 * - If it's an integer string, we shift decimals (18).
 * - Always returns a string (no commas).
 */
function toHumanDecimalString(
  value: string | number | null | undefined,
  decimals = TOKEN_DECIMALS
): string {
  if (value === null || value === undefined) return "0";

  const s = String(value).trim();
  if (!s) return "0";

  // already a decimal string (human)
  if (s.includes(".")) return s;

  // integer string?
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;

  if (!/^\d+$/.test(digits)) return s;

  // shift decimals
  const pad = decimals + 1;
  const padded = digits.length < pad ? digits.padStart(pad, "0") : digits;

  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);

  const fracTrimmed = fracPart.replace(/0+$/, "");
  const out = fracTrimmed.length ? `${intPart}.${fracTrimmed}` : intPart;

  return neg ? `-${out}` : out;
}

/**
 * Format a human decimal string with commas and a controlled number of decimals.
 * - Keeps up to `maxFractionDigits` but trims trailing zeros.
 */
function formatHumanWithCommas(humanDecimal: string, maxFractionDigits = 6): string {
  if (!humanDecimal) return "-";

  const neg = humanDecimal.startsWith("-");
  const s = neg ? humanDecimal.slice(1) : humanDecimal;

  const [intRaw, fracRaw = ""] = s.split(".");
  const intPart = intRaw.replace(/^0+(?=\d)/, "") || "0";
  const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (!fracRaw) return neg ? `-${intWithCommas}` : intWithCommas;

  const fracLimited = fracRaw.slice(0, maxFractionDigits).replace(/0+$/, "");
  if (!fracLimited) return neg ? `-${intWithCommas}` : intWithCommas;

  return neg ? `-${intWithCommas}.${fracLimited}` : `${intWithCommas}.${fracLimited}`;
}

/**
 * Convenience: value -> human string -> formatted string with commas
 * Use this when you might be holding RAW (integer string) OR human.
 */
function formatToken(value: string | number | null | undefined, maxFractionDigits = 6): string {
  const human = toHumanDecimalString(value, TOKEN_DECIMALS);
  return formatHumanWithCommas(human, maxFractionDigits);
}

/**
 * Convert to a JS number for calculations (approx). Safe enough for UI metrics.
 * (We convert raw->human first.)
 */
function toNumberApprox(value: string | number | null | undefined): number {
  const human = toHumanDecimalString(value, TOKEN_DECIMALS);
  const x = Number(human);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Number formatter for already-human numbers (volume/inflow/outflow/net).
 * Keeps commas and up to maxFractionDigits decimals.
 */
function formatNumberWithCommas(num: number, maxFractionDigits = 4): string {
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

/**
 * Signed number string with commas (not compact K/M/B).
 */
function formatSignedNumberWithCommas(num: number, maxFractionDigits = 4): string {
  if (!Number.isFinite(num)) return "-";
  if (num === 0) return "0";
  const sign = num > 0 ? "+" : "−";
  return `${sign}${formatNumberWithCommas(Math.abs(num), maxFractionDigits)}`;
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
      : transfers.slice(0, 250); // fallback

    const activeWalletsSet = new Set<string>();
    let volume24h = 0;

    for (const t of last24h) {
      if (t.from_address) activeWalletsSet.add(t.from_address.toLowerCase());
      if (t.to_address) activeWalletsSet.add(t.to_address.toLowerCase());

      // ✅ prefer raw when available
      const amtPick = pickTokenValue(t.amount_raw, t.amount_bc400);
      volume24h += toNumberApprox(amtPick);
    }

    const top20 = holders.slice(0, 20);
    const top10 = holders.slice(0, 10);

    // ✅ prefer raw when available for holder balances too
    const totalTop20 = top20.reduce(
      (acc, h) => acc + toNumberApprox(pickTokenValue(h.balance_raw, h.balance_bc400)),
      0
    );
    const totalTop10 = top10.reduce(
      (acc, h) => acc + toNumberApprox(pickTokenValue(h.balance_raw, h.balance_bc400)),
      0
    );

    const topSet = new Set(top20.map((h) => h.address.toLowerCase()));

    let inflow = 0;
    let outflow = 0;

    for (const t of last24h) {
      const fromTop = topSet.has((t.from_address || "").toLowerCase());
      const toTop = topSet.has((t.to_address || "").toLowerCase());

      // ✅ prefer raw when available
      const amtPick = pickTokenValue(t.amount_raw, t.amount_bc400);
      const amt = toNumberApprox(amtPick);

      if (toTop && !fromTop) inflow += amt;
      if (fromTop && !toTop) outflow += amt;
    }

    const whaleNet = inflow - outflow;
    const indexLag = summary ? Math.max(0, summary.lastIndexedBlock - summary.firstBlock) : 0;

    return {
      hasTimestamps,
      transfersWindowLabel: hasTimestamps ? "last 24h" : "latest 250 transfers (timestamps missing)",
      activeWallets24h: activeWalletsSet.size,
      volume24h,
      top10Concentration: totalTop20 > 0 ? (totalTop10 / totalTop20) * 100 : null,
      whaleNet,
      inflow,
      outflow,
      indexLag,
    };
  }, [holders, transfers, summary]);

  const reportStatusTone = error ? "bad" : healthOk ? "ok" : "warn";

  const reportStatusText = error ? "API not reachable" : healthOk ? "System reachable (health OK)" : "Health not OK";
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
              hint={
                audit.hasTimestamps
                  ? "True 24h window (block_time present)."
                  : "Fallback window used because timestamps are missing."
              }
            />
          </div>

          {error && <div className="audit-error">Error: {error}</div>}

          <div className="audit-hero">
            <div className="audit-hero-left">
              <div className="audit-hero-title">Confidence Signals</div>
              <div className="audit-hero-grid">
                <div className="audit-metric">
                  <div className="audit-metric-label">Active wallets</div>
                  <div className="audit-metric-value">{audit.activeWallets24h.toLocaleString()}</div>
                  <div className="audit-metric-note">Unique wallets seen in {audit.transfersWindowLabel}.</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Transfer volume (BC400)</div>
                  <div className="audit-metric-value">{formatNumberWithCommas(audit.volume24h, 4)}</div>
                  <div className="audit-metric-note">Sum of transfer amounts in {audit.transfersWindowLabel}.</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Total wallets</div>
                  <div className="audit-metric-value">{summary ? summary.totalWallets.toLocaleString() : "-"}</div>
                  <div className="audit-metric-note">From /summary (indexed wallets).</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Whale net flow (BC400)</div>
                  <div className="audit-metric-value">{formatSignedNumberWithCommas(audit.whaleNet, 4)}</div>
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
                  <div className="audit-metric-value">{summary ? summary.lastIndexedBlock.toLocaleString() : "-"}</div>
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
                  To make this investor-grade, we’ll add on-chain DEX pair detection + locker detection
                  (PinkLock/Unicrypt/TeamFinance/own lockers) and then show:
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
                <span className="audit-v">{formatSignedNumberWithCommas(audit.whaleNet, 4)} BC400</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Inflow to top holders:</span>
                <span className="audit-v">{formatNumberWithCommas(audit.inflow, 4)} BC400</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Outflow from top holders:</span>
                <span className="audit-v">{formatNumberWithCommas(audit.outflow, 4)} BC400</span>
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
                <span className="audit-v">{audit.activeWallets24h.toLocaleString()}</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Total wallets now:</span>
                <span className="audit-v">{summary ? summary.totalWallets.toLocaleString() : "-"}</span>
              </div>
              <div className="audit-muted">
                Investors love trend-lines. Next step is a small backend endpoint that stores daily snapshots so we can chart growth.
              </div>
            </div>
          </div>

          <div className="audit-footer-note">
            This page is <b>live</b> right now because it uses your existing endpoints only — no new backend route required.
          </div>

          {/* hidden sanity: raw->human formatter works */}
          <div style={{ display: "none" }}>{formatToken("340735009809941307134", 6)}</div>
        </section>
      </div>
    </div>
  );
};