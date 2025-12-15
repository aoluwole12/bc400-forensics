import { useEffect, useMemo, useState } from "react";
import "../index.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

type DailyReport = {
  generatedAt: string;
  security: { criticalAlerts: boolean };
  whales: { net_bc400: number; window_hours: number };
  holders: {
    total_now: number;
    new_24h: number;
    pct_change_24h: number | null;
  };
  liquidity: { lock_percent: number; changed_24h: boolean };
};

function formatSignedMillions(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const sign = value > 0 ? "+" : "−";
  const abs = Math.abs(value);

  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    return `${sign}${millions.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })}M`;
  }
  return `${sign}${abs.toLocaleString()}`;
}

export function DailyAuditPage() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API_BASE}/daily-report`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as DailyReport;
        if (!cancelled) setReport(data);
      } catch (e) {
        console.error("Daily report fetch failed:", e);
        if (!cancelled) setError("Could not load live daily audit data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const generatedAt = useMemo(() => {
    if (!report?.generatedAt) return null;
    const d = new Date(report.generatedAt);
    if (Number.isNaN(d.getTime())) return report.generatedAt;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [report?.generatedAt]);

  const noCritical = report ? !report.security.criticalAlerts : true;

  return (
    <section className="panel audit-panel">
      <div className="audit-header">
        <div>
          <h2 className="audit-title">Daily BC400 Audit Report</h2>
          <p className="audit-subtitle">
            Auto-generated recap using your live indexer data.
          </p>
        </div>

        <div className="audit-meta">
          <span className="audit-label">Report Status</span>
          <span
            className={
              noCritical
                ? "audit-pill audit-pill--ok"
                : "audit-pill audit-pill--alert"
            }
          >
            {noCritical ? "No critical alerts" : "Critical alerts detected"}
          </span>

          <span className="audit-timestamp">
            {loading && "Loading live data..."}
            {!loading && error && error}
            {!loading && !error && generatedAt && `Last updated: ${generatedAt}`}
          </span>
        </div>
      </div>

      <div className="audit-grid">
        <div className="audit-card">
          <h3 className="audit-card-title">Security</h3>
          <p className="audit-card-main">
            {report
              ? noCritical
                ? "No critical alerts in last 24h."
                : "Review required: high-severity alert detected in last 24h."
              : "Scanning last 24h window..."}
          </p>
          <p className="audit-card-note">
            Source: <code>/daily-report</code>. This becomes “real” once your
            actual security rules are wired in.
          </p>
        </div>

        <div className="audit-card">
          <h3 className="audit-card-title">Whale Activity</h3>
          <p className="audit-card-main">
            {report
              ? `Whales net ${formatSignedMillions(report.whales.net_bc400)} BC400.`
              : "Calculating whale flows..."}
          </p>
          <p className="audit-card-note">
            Window: {report?.whales.window_hours ?? 24}h, based on live transfers
            in Postgres.
          </p>
        </div>

        <div className="audit-card">
          <h3 className="audit-card-title">Holder Growth</h3>
          <p className="audit-card-main">
            {report ? (
              <>
                New holders: +{report.holders.new_24h}{" "}
                {report.holders.pct_change_24h !== null
                  ? `(${report.holders.pct_change_24h.toFixed(1)}%)`
                  : "(—)"}
                .
              </>
            ) : (
              "Measuring net new wallets..."
            )}
          </p>
          <p className="audit-card-note">
            New holders = wallets receiving BC400 for the first time in the last
            24 hours.
          </p>
        </div>

        <div className="audit-card">
          <h3 className="audit-card-title">Liquidity</h3>
          <p className="audit-card-main">
            {report ? (
              report.liquidity.changed_24h ? (
                <>LP changed in last 24h; currently {report.liquidity.lock_percent}% locked.</>
              ) : (
                <>LP unchanged; remains {report.liquidity.lock_percent}% locked.</>
              )
            ) : (
              "Checking LP status..."
            )}
          </p>
          <p className="audit-card-note">
            Stays aligned to <code>/daily-report</code> until lock-contract logic
            is connected.
          </p>
        </div>
      </div>

      <p className="audit-footer-note">
        Source: your live Postgres index (same dataset as Summary / Holders /
        Transfers).
      </p>
    </section>
  );
}
