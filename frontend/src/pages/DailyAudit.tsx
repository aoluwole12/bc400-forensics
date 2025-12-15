import React, { useEffect, useMemo, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";
import { useNavigate } from "react-router-dom";

// Prefer VITE_API_BASE_URL, fallback to localhost backend.
// Trim trailing slash to avoid //daily-report
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");

type DailyReport = {
  generatedAt: string; // ISO string
  security?: {
    criticalAlerts?: boolean;
  };
  whales?: {
    net_bc400?: number;
    window_hours?: number;
  };
  holders?: {
    total_now?: number;
    new_24h?: number;
    pct_change_24h?: number | null;
  };
  liquidity?: {
    lock_percent?: number;
    changed_24h?: boolean;
  };
  // allow backend to add more fields later without breaking
  [key: string]: any;
};

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; report: DailyReport }
  | { status: "error"; message: string; details?: string };

function formatSignedCompact(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const sign = value > 0 ? "+" : "−";
  const abs = Math.abs(value);

  // compact formatting for large numbers
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toLocaleString()}`;
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export const DailyAudit: React.FC = () => {
  const navigate = useNavigate();

  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [refreshTick, setRefreshTick] = useState(0);

  // Optional: set to true if you want it to refresh automatically
  const AUTO_REFRESH = false;
  const AUTO_REFRESH_MS = 60_000;

  const endpoint = useMemo(() => `${API_BASE}/daily-report`, []);

  async function loadDailyReport() {
    setState({ status: "loading" });

    try {
      const res = await fetchWithTimeout(endpoint, { method: "GET" });

      if (!res.ok) {
        // Try to capture error body (if JSON)
        let bodyText = "";
        try {
          bodyText = await res.text();
        } catch {
          bodyText = "";
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}${bodyText ? ` — ${bodyText}` : ""}`);
      }

      const data = (await res.json()) as DailyReport;

      // Minimal sanity checks
      if (!data || typeof data.generatedAt !== "string") {
        throw new Error("Invalid daily-report payload (missing generatedAt).");
      }

      setState({ status: "loaded", report: data });
    } catch (err: any) {
      const isAbort = err?.name === "AbortError";
      setState({
        status: "error",
        message: isAbort ? "Request timed out. Check API_BASE and backend status." : "Could not load live audit data.",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!alive) return;
      await loadDailyReport();
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  useEffect(() => {
    if (!AUTO_REFRESH) return;
    const id = setInterval(() => setRefreshTick((t) => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [AUTO_REFRESH]);

  const report = state.status === "loaded" ? state.report : null;

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
    });
  }, [report?.generatedAt]);

  const criticalAlerts = report?.security?.criticalAlerts ?? false;

  const whalesNet = report?.whales?.net_bc400 ?? 0;
  const whaleWindowHours = report?.whales?.window_hours ?? 24;

  const holderTotal = report?.holders?.total_now ?? 0;
  const holderNew = report?.holders?.new_24h ?? 0;
  const holderPct = report?.holders?.pct_change_24h ?? null;

  const lpLockPercent = report?.liquidity?.lock_percent ?? 0;
  const lpChanged = report?.liquidity?.changed_24h ?? false;

  return (
    <div className="app-root">
      <div className="app-shell">
        <Header />

        <section className="panel audit-panel">
          <div className="audit-header">
            <div>
              <h2 className="audit-title">Daily BC400 Audit Report</h2>
              <p className="audit-subtitle">
                Human-style 24h recap for BC400 — generated from live indexer data.
              </p>
              <p className="audit-subtitle" style={{ opacity: 0.85 }}>
                Source: <span style={{ fontFamily: "monospace" }}>{endpoint}</span>
              </p>
            </div>

            <div className="audit-meta">
              <button type="button" className="audit-back-button" onClick={() => navigate("/")}>
                ← Back to dashboard
              </button>

              <button
                type="button"
                className="audit-back-button"
                onClick={() => setRefreshTick((t) => t + 1)}
                style={{ marginLeft: 8 }}
              >
                ⟳ Refresh
              </button>

              <span className="audit-label">Report Status</span>
              <span className={criticalAlerts ? "audit-pill audit-pill--alert" : "audit-pill audit-pill--ok"}>
                {criticalAlerts ? "Critical alerts detected" : "No critical alerts"}
              </span>

              <span className="audit-timestamp">
                {state.status === "loading" && "Loading live data..."}
                {state.status === "error" && (
                  <>
                    {state.message}
                    {state.details ? (
                      <span style={{ display: "block", opacity: 0.85, fontFamily: "monospace" }}>
                        {state.details}
                      </span>
                    ) : null}
                  </>
                )}
                {state.status === "loaded" && generatedAt && `Last updated: ${generatedAt}`}
              </span>
            </div>
          </div>

          <div className="audit-grid">
            <div className="audit-card">
              <h3 className="audit-card-title">Security</h3>
              <p className="audit-card-main">
                {state.status === "loaded"
                  ? criticalAlerts
                    ? "Review required: at least one high-severity alert in the last 24h."
                    : "No critical alerts in last 24h."
                  : "Scanning last 24h window for protocol and on-chain alerts..."}
              </p>
              <p className="audit-card-note">
                Critical alerts include major exploits, emergency pauses, blacklist events, or high-risk admin actions
                affecting BC400 infrastructure.
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Whale Activity</h3>
              <p className="audit-card-main">
                {state.status === "loaded"
                  ? `Whales net ${formatSignedCompact(whalesNet)} BC400.`
                  : "Calculating net whale flows across tracked wallets..."}
              </p>
              <p className="audit-card-note">
                Net position change across tracked top holders over the last {whaleWindowHours} hours, using indexed
                transfer data.
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Holder Growth</h3>
              <p className="audit-card-main">
                {state.status === "loaded" ? (
                  <>
                    Holder count +{holderNew.toLocaleString()}
                    {" "}
                    (
                    {holderPct !== null && Number.isFinite(holderPct) ? `${holderPct.toFixed(1)}%` : "—"}
                    ). Total now: {holderTotal.toLocaleString()}.
                  </>
                ) : (
                  "Measuring net new BC400 wallets vs. the prior 24h period..."
                )}
              </p>
              <p className="audit-card-note">
                New holders are wallets that received BC400 for the first time in the last 24 hours (based on indexed
                first-seen logic).
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Liquidity</h3>
              <p className="audit-card-main">
                {state.status === "loaded" ? (
                  lpChanged ? (
                    <>
                      LP changed in last 24h; currently {lpLockPercent}% locked.
                    </>
                  ) : (
                    <>
                      LP unchanged; remains {lpLockPercent}% locked.
                    </>
                  )
                ) : (
                  "Checking LP position, lock status and recent changes..."
                )}
              </p>
              <p className="audit-card-note">
                This is a live slot for LP lock + LP delta tracking (lock contracts / LP events). If you want, we’ll wire
                it to on-chain lock contracts next.
              </p>
            </div>
          </div>

          <p className="audit-footer-note">
            This report reads from the same Postgres-backed indexer that powers your dashboard tables.
            Next step: we’ll ensure /daily-report is generated from real whale flows, holder delta, and LP events — not placeholders.
          </p>
        </section>
      </div>
    </div>
  );
};
