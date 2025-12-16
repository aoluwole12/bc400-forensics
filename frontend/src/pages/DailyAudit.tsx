import React, { useEffect, useMemo, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const TOKEN_DECIMALS = 18;

type DailyReport = {
  generatedAt: string;
  security: { criticalAlerts: boolean };
  whales: { net_bc400: number | string; window_hours: number };
  holders: { total_now: number; new_24h: number; pct_change_24h: number | null };
  liquidity: { lock_percent: number; changed_24h: boolean };
};

/**
 * Converts raw integer strings (18 decimals) into a human decimal string.
 * If the value already contains ".", we assume it's already human.
 */
function toHumanDecimalString(
  value: string | number | null | undefined,
  decimals = TOKEN_DECIMALS
): string {
  if (value === null || value === undefined) return "0";

  const s = String(value).trim();
  if (!s) return "0";

  // already human (has decimal)
  if (s.includes(".")) return s;

  // integer string?
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;

  if (!/^\d+$/.test(digits)) return s;

  const pad = decimals + 1;
  const padded = digits.length < pad ? digits.padStart(pad, "0") : digits;

  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);

  const fracTrimmed = fracPart.replace(/0+$/, "");
  const out = fracTrimmed.length ? `${intPart}.${fracTrimmed}` : intPart;

  return neg ? `-${out}` : out;
}

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

function formatToken(value: string | number, maxFractionDigits = 6): string {
  const human = toHumanDecimalString(value, TOKEN_DECIMALS);
  return formatHumanWithCommas(human, maxFractionDigits);
}

/**
 * Whale net formatter:
 * - If the backend sends raw integer (18d) -> we convert.
 * - If backend already sends human number -> we keep it and format.
 */
function formatSignedToken(value: string | number): string {
  const human = toHumanDecimalString(value, TOKEN_DECIMALS);
  // preserve sign and show commas/decimals
  const n = Number(human);
  if (Number.isFinite(n)) {
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return sign + formatHumanWithCommas(String(Math.abs(n)), 4);
  }
  // if can't parse, just display the formatted human string
  if (human.startsWith("-")) return "−" + formatHumanWithCommas(human.slice(1), 4);
  return "+" + formatHumanWithCommas(human, 4);
}

export const DailyAuditPage: React.FC = () => {
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
        console.error(e);
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
    <div className="app-root">
      <div className="app-shell">
        <Header />

        <section className="panel audit-panel">
          <div className="audit-header">
            <div>
              <h2 className="audit-title">Daily BC400 Audit Report</h2>
              <p className="audit-subtitle">Auto-generated recap using live indexer data.</p>
            </div>

            <div className="audit-meta">
              <span className="audit-label">Report Status</span>
              <span className={noCritical ? "audit-pill audit-pill--ok" : "audit-pill audit-pill--alert"}>
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
                This uses /daily-report. We’ll expand this when your real security rules are wired in.
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Whale Activity</h3>
              <p className="audit-card-main">
                {report ? `Whales net ${formatSignedToken(report.whales.net_bc400)} BC400.` : "Calculating whale flows..."}
              </p>
              <p className="audit-card-note">
                Window: {report?.whales.window_hours ?? 24}h. Based on live transfer data in Postgres.
              </p>
            </div>

            <div className="audit-card">
              <h3 className="audit-card-title">Holder Growth</h3>
              <p className="audit-card-main">
                {report ? (
                  <>
                    New holders: +{Number(report.holders.new_24h).toLocaleString()}{" "}
                    {report.holders.pct_change_24h !== null ? `(${report.holders.pct_change_24h.toFixed(1)}%)` : "(—)"}.
                  </>
                ) : (
                  "Measuring net new wallets..."
                )}
              </p>
              <p className="audit-card-note">New holders = wallets receiving BC400 for the first time in last 24h.</p>
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
              <p className="audit-card-note">This stays aligned to /daily-report until you plug in lock-contract logic.</p>
            </div>
          </div>

          <p className="audit-footer-note">
            Source: your live Postgres index (same dataset as Summary / Holders / Transfers).
          </p>
        </section>
      </div>
    </div>
  );
};