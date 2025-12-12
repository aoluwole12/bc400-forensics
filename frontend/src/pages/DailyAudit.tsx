import React, { useEffect, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";
import { useNavigate } from "react-router-dom";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

type DailyReport = {
  generatedAt: string;
  security: {
    criticalAlerts: boolean;
  };
  whales: {
    net_bc400: number;
    window_hours: number;
  };
  holders: {
    total_now: number;
    new_24h: number;
    pct_change_24h: number | null;
  };
  liquidity: {
    lock_percent: number;
    changed_24h: boolean;
  };
};

function formatSignedMillions(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
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

export const DailyAudit: React.FC = () => {
  const navigate = useNavigate();
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
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as DailyReport;
        if (!cancelled) {
          setReport(data);
        }
      } catch (err: any) {
        console.error("Failed to load daily report", err);
        if (!cancelled) {
          setError("Could not load live audit data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const generatedAt = report
    ? new Date(report.generatedAt).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const noCritical = report ? !report.security.criticalAlerts : true;

  return (
    <div className="app-root">
      <div className="app-shell">
        <Header />

        <section className="panel audit-panel">
          <div className="audit-header">
            <div>
              <h2 className="audit-title">Daily BC400 Audit Report</h2>
              <p className="audit-subtitle">
                Auto-generated, human-style recap for BC400 holders.
              </p>
            </div>

            <div className="audit-meta">
              <button
                type="button"
                className="audit-back-button"
                onClick={() => navigate("/")}
              >
                ← Back to dashboard
              </button>

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
                {loading && !report && !error && "Loading live data..."}
                {error && !loading && error}
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
                    : "Review required: at least one high-severity alert in last 24h."
                  : "Scanning last 24h window for protocol and on-chain alerts..."}
              </p>
              <p className="audit-card-note">
                Critical alerts include major exploits, emergency pauses, or
                blacklist events affecting BC400 contracts or core infrastructure.
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Whale Activity</h3>
              <p className="audit-card-main">
                {report
                  ? `Whales net ${formatSignedMillions(
                      report.whales.net_bc400
                    )} BC400.`
                  : "Calculating net whale flows across tracked wallets..."}
              </p>
              <p className="audit-card-note">
                Net position change across the top holders over the last{" "}
                {report?.whales.window_hours ?? 24} hours, using live transfer data
                from the BC400 indexer.
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Holder Growth</h3>
              <p className="audit-card-main">
                {report ? (
                  <>
                    Holder count +{report.holders.new_24h} (
                    {report.holders.pct_change_24h !== null
                      ? `${report.holders.pct_change_24h.toFixed(1)}%`
                      : "—"}
                    ).
                  </>
                ) : (
                  "Measuring net new BC400 wallets vs. the prior 24h period..."
                )}
              </p>
              <p className="audit-card-note">
                New holders are wallets that received BC400 for the first time in
                the last 24 hours. Percentage is relative to the prior holder base.
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Liquidity</h3>
              <p className="audit-card-main">
                {report ? (
                  report.liquidity.changed_24h ? (
                    <>
                      LP changed in last 24h; currently{" "}
                      {report.liquidity.lock_percent}% locked.
                    </>
                  ) : (
                    <>
                      LP unchanged; remains {report.liquidity.lock_percent}% locked.
                    </>
                  )
                ) : (
                  "Checking LP position, lock status and recent changes..."
                )}
              </p>
              <p className="audit-card-note">
                Future versions will pull LP lock status directly from lock
                contracts and alert on any unlocks, pulls or ownership changes.
              </p>
            </div>
          </div>

          <p className="audit-footer-note">
            This report is generated using the same live Postgres index as the
            main BC400 dashboard. Once security rules and LP monitors are wired
            in, this card will become the public daily “all-clear” for BC400.
          </p>
        </section>
      </div>
    </div>
  );
};
