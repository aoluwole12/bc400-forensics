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
  balance_bc400: string;
};

type Transfer = {
  block_time: string | null;
  from_address: string;
  to_address: string;
  amount_bc400: string | null;
};

function normalizeHolder(raw: any, index: number): Holder {
  return {
    rank: raw.rank ?? raw.position ?? raw.index ?? index + 1,
    address: raw.address ?? raw.wallet ?? "",
    balance_bc400: raw.balance_bc400 ?? raw.balance ?? raw.balanceRaw ?? "0",
  };
}

function normalizeTransfer(raw: any): Transfer {
  return {
    block_time: raw.block_time ?? raw.blockTime ?? raw.time ?? null,
    from_address: raw.from_address ?? raw.fromAddress ?? raw.from ?? "",
    to_address: raw.to_address ?? raw.toAddress ?? raw.to ?? "",
    amount_bc400:
      raw.amount_bc400 ??
      raw.amount ??
      raw.value ??
      raw.raw_amount ??
      raw.rawAmount ??
      null,
  };
}

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const x = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(x) ? x : 0;
}

function formatCompact(num: number): string {
  if (!Number.isFinite(num)) return "-";
  const abs = Math.abs(num);
  if (abs >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (num / 1e3).toFixed(2) + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatSigned(num: number): string {
  if (!Number.isFinite(num)) return "-";
  const sign = num > 0 ? "+" : num < 0 ? "−" : "";
  return sign + formatCompact(Math.abs(num));
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
    let volume24h = 0;

    for (const t of last24h) {
      if (t.from_address) activeWalletsSet.add(t.from_address.toLowerCase());
      if (t.to_address) activeWalletsSet.add(t.to_address.toLowerCase());
      volume24h += n(t.amount_bc400);
    }

    const top20 = holders.slice(0, 20);
    const top10 = holders.slice(0, 10);

    const totalTop20 = top20.reduce((acc, h) => acc + n(h.balance_bc400), 0);
    const totalTop10 = top10.reduce((acc, h) => acc + n(h.balance_bc400), 0);

    const topSet = new Set(top20.map((h) => h.address.toLowerCase()));

    // “Whale flow proxy” = net change involving top holders in last24h:
    // Inflow: transfers TO top holders
    // Outflow: transfers FROM top holders
    let inflow = 0;
    let outflow = 0;

    for (const t of last24h) {
      const fromTop = topSet.has((t.from_address || "").toLowerCase());
      const toTop = topSet.has((t.to_address || "").toLowerCase());
      const amt = n(t.amount_bc400);

      if (toTop && !fromTop) inflow += amt;
      if (fromTop && !toTop) outflow += amt;
    }

    const whaleNet = inflow - outflow;

    // Confidence signals
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

  const reportStatusTone = error
    ? "bad"
    : healthOk
    ? "ok"
    : "warn";

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
            <SignalBadge
              label="Last updated"
              value={loading ? "…" : updatedText}
              tone="neutral"
            />
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
                  <div className="audit-metric-value">{formatCompact(audit.activeWallets24h)}</div>
                  <div className="audit-metric-note">Unique wallets seen in {audit.transfersWindowLabel}.</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Transfer volume (BC400)</div>
                  <div className="audit-metric-value">{formatCompact(audit.volume24h)}</div>
                  <div className="audit-metric-note">Sum of transfer amounts in {audit.transfersWindowLabel}.</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Total wallets</div>
                  <div className="audit-metric-value">{summary ? formatCompact(summary.totalWallets) : "-"}</div>
                  <div className="audit-metric-note">From /summary (indexed wallets).</div>
                </div>

                <div className="audit-metric">
                  <div className="audit-metric-label">Whale net flow (BC400)</div>
                  <div className="audit-metric-value">{formatSigned(audit.whaleNet)}</div>
                  <div className="audit-metric-note">
                    Proxy from last transfers involving top holders (in − out).
                  </div>
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
                  <div className="audit-metric-value">
                    {summary ? `${summary.lastIndexedBlock}` : "-"}
                  </div>
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
                <span className="audit-v">{formatSigned(audit.whaleNet)} BC400</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Inflow to top holders:</span>
                <span className="audit-v">{formatCompact(audit.inflow)} BC400</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Outflow from top holders:</span>
                <span className="audit-v">{formatCompact(audit.outflow)} BC400</span>
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
                <span className="audit-v">{formatCompact(audit.activeWallets24h)}</span>
              </div>
              <div className="audit-line">
                <span className="audit-k">Total wallets now:</span>
                <span className="audit-v">{summary ? formatCompact(summary.totalWallets) : "-"}</span>
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
