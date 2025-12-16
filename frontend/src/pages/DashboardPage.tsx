import { useEffect, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";

type Summary = {
  firstBlock: number;
  lastIndexedBlock: number;
  totalTransfers: number;
  totalWallets: number;
};

type Holder = {
  rank: number;
  address: string;
  balance_bc400: string;          // fallback human (sometimes present)
  balance_raw?: string | null;    // preferred raw (18dp) if present
  tx_count: number;
  first_seen: string | null;
  last_seen: string | null;
};

type Transfer = {
  block_number: number;
  block_time: string | null;
  from_address: string;
  to_address: string;
  amount_bc400: string | null;     // fallback human (sometimes present)
  amount_raw?: string | null;      // preferred raw (18dp) if present
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

/**
 * BC400 is 18 decimals.
 * Formatter supports:
 * - already-human decimal string (e.g. "1234.56")
 * - raw integer string (e.g. "1000000000000000000") in 18dp
 *
 * Uses BigInt so huge balances do not lose precision.
 */
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

/**
 * Detect "raw 18dp token integer string".
 * - integer-only
 * - at least 19 digits (meaning it could contain fractional units once shifted by 18)
 */
function looksRaw18(v: string): boolean {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(s)) return false;
  const digitsLen = s.replace("-", "").length;
  return digitsLen >= 19;
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

  // trim trailing zeros but keep at least minFrac
  fracCut = fracCut.replace(/0+$/, "");
  while (fracCut.length < minFrac) fracCut += "0";
  if (fracCut.length === 0) fracCut = "0".repeat(minFrac);

  const out = `${wholeStr}.${fracCut}`;
  return neg ? `-${out}` : out;
}

function formatHumanDecimal(input: string, maxFrac = 6, minFrac = 0): string {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (s === "" || s === "-") return "0";

  // integer → commas only
  if (/^-?\d+$/.test(s)) return addCommas(s);

  // decimal string → commas + trimmed decimals
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const neg = s.startsWith("-");
    const v = neg ? s.slice(1) : s;

    const [w = "0", f = ""] = v.split(".");
    const whole = addCommas((w || "0").replace(/^0+(?=\d)/, "") || "0");

    let frac = (f || "").slice(0, maxFrac);
    frac = frac.replace(/0+$/, "");
    while (frac.length < minFrac) frac += "0";

    return frac.length ? `${neg ? "-" : ""}${whole}.${frac}` : `${neg ? "-" : ""}${whole}`;
  }

  // fallback (non-numeric)
  return input;
}

/**
 * Non-token numeric formatter (blocks, totals, tx counts).
 * Never shifts decimals. Never uses Number() for comma placement.
 */
function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return formatHumanDecimal(String(value), 6, 0);
}

/**
 * Token formatter for BC400 amounts/balances.
 * - raw 18dp integer => shift by 18
 * - human decimal => commas + 2..6 decimals
 */
function formatToken(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const s = String(value).trim();

  // raw integer (18dp)
  if (looksRaw18(s)) return formatFromRaw18(s, 6, 2);

  // already-human decimal or small integer (still show 2 decimals)
  return formatHumanDecimal(s, 6, 2);
}

/**
 * ✅ Best-practice selector:
 * Prefer raw (exact) if present, otherwise fall back to human.
 */
function formatTokenPreferRaw(raw: string | null | undefined, human: string | null | undefined): string {
  const pick = raw && String(raw).trim() !== "" ? raw : human;
  return formatToken(pick);
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

function normalizeHolder(raw: any, index: number): Holder {
  return {
    rank: raw.rank ?? raw.position ?? raw.index ?? index + 1,
    address: raw.address ?? raw.wallet ?? "",
    // fallback human
    balance_bc400: raw.balance_bc400 ?? raw.balanceBC400 ?? raw.balance ?? "0",
    // preferred raw
    balance_raw: raw.balanceRaw ?? raw.balance_raw ?? raw.balance_raw_18 ?? null,
    tx_count: raw.tx_count ?? raw.txCount ?? raw.transferCount ?? 0,
    first_seen: raw.first_seen ?? raw.firstSeen ?? null,
    last_seen: raw.last_seen ?? raw.lastSeen ?? null,
  };
}

function normalizeTransfer(raw: any): Transfer {
  return {
    block_number: raw.block_number ?? raw.blockNumber ?? 0,
    block_time: raw.block_time ?? raw.blockTime ?? raw.time ?? null,
    from_address: raw.from_address ?? raw.fromAddress ?? raw.from ?? "",
    to_address: raw.to_address ?? raw.toAddress ?? raw.to ?? "",
    // fallback human
    amount_bc400: raw.amount_bc400 ?? raw.amountBC400 ?? raw.amount ?? raw.value ?? null,
    // preferred raw
    amount_raw: raw.raw_amount ?? raw.rawAmount ?? raw.amount_raw ?? null,
  };
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [systemOnline, setSystemOnline] = useState<boolean>(false);

  useEffect(() => {
    async function load() {
      try {
        const [healthRes, summaryRes, holdersRes, transfersRes] = await Promise.all([
          fetch(`${API_BASE}/health`),
          fetch(`${API_BASE}/summary`),
          fetch(`${API_BASE}/top-holders`),
          fetch(`${API_BASE}/transfers`),
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
        }

        if (transfersRes.ok) {
          const data = await transfersRes.json();
          let raw: any[] = [];
          if (Array.isArray(data)) raw = data;
          else if (Array.isArray(data.transfers)) raw = data.transfers;
          else if (Array.isArray(data.items)) raw = data.items;
          setTransfers(raw.map((t) => normalizeTransfer(t)));
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
        setSystemOnline(false);
      }
    }

    load();
  }, []);

  const top20 = holders.slice(0, 20);
  const last20Transfers = transfers.slice(0, 20);

  return (
    <div className="app-root">
      <div className="app-shell">
        <Header />

        <section className="panel panel--status">
          <div className="panel-block">
            <h2 className="panel-title panel-title--index">Index Status</h2>
            {summary ? (
              <dl className="stats-grid">
                <div>
                  <dt>First Block</dt>
                  <dd>{formatNumber(summary.firstBlock)}</dd>
                </div>
                <div>
                  <dt>Last Indexed Block</dt>
                  <dd>{formatNumber(summary.lastIndexedBlock)}</dd>
                </div>
                <div>
                  <dt>Total Transfers</dt>
                  <dd>{formatNumber(summary.totalTransfers)}</dd>
                </div>
                <div>
                  <dt>Total Wallets</dt>
                  <dd>{formatNumber(summary.totalWallets)}</dd>
                </div>
              </dl>
            ) : (
              <p className="panel-muted">No summary data yet.</p>
            )}
          </div>

          <div className="panel-block panel-block--health">
            <h2 className="panel-title panel-title--system">System Health</h2>
            <div className="system-health-row">
              <span className="system-label">Indexer:</span>
              <span className={systemOnline ? "system-value system-value--ok" : "system-value system-value--bad"}>
                {systemOnline ? "Online" : "Offline"}
              </span>

              <span className="system-label system-label--spacer">API Base:</span>
              <span className={systemOnline ? "system-value system-value--ok" : "system-value system-value--bad"}>
                {systemOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </section>

        <section className="panel panel--table">
          <div className="panel-header-row">
            <h2 className="panel-title">Top Holders</h2>
            <span className="panel-caption">Showing top {top20.length} wallets</span>
          </div>

          {top20.length === 0 ? (
            <p className="panel-muted">No holder data yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table data-table--holders">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th>Address</th>
                    <th className="col-balance">Balance (BC400)</th>
                    <th className="col-tx">Tx Count</th>
                    <th className="col-tags">Tags</th>
                    <th className="col-time">First Seen</th>
                    <th className="col-time">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {top20.map((h) => (
                    <tr key={h.address}>
                      <td className="col-rank">{h.rank}</td>
                      <td className="address-cell">{h.address}</td>

                      {/* ✅ Best practice: prefer raw when available */}
                      <td className="col-balance">
                        {formatTokenPreferRaw(h.balance_raw ?? null, h.balance_bc400)}
                      </td>

                      <td className="col-tx">{formatNumber(h.tx_count ?? 0)}</td>
                      <td className="col-tags">none</td>
                      <td className="col-time">{formatDateTime(h.first_seen)}</td>
                      <td className="col-time">{formatDateTime(h.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel panel--table panel--recent">
          <div className="panel-header-row">
            <h2 className="panel-title">Recent Transfers</h2>
            <span className="panel-caption">Latest {last20Transfers.length} indexed transfers</span>
          </div>

          {last20Transfers.length === 0 ? (
            <p className="panel-muted">No transfers found.</p>
          ) : (
            <div className="table-scroll table-scroll--recent">
              <table className="data-table data-table--transfers">
                <thead>
                  <tr>
                    <th className="col-block">Block</th>
                    <th className="col-time">Time</th>
                    <th>From</th>
                    <th>To</th>
                    <th className="col-amount">Amount (BC400)</th>
                  </tr>
                </thead>
                <tbody>
                  {last20Transfers.map((t, idx) => (
                    <tr key={`${t.block_number}-${idx}-${t.from_address}-${t.to_address}`}>
                      <td className="col-block">{formatNumber(t.block_number)}</td>
                      <td className="col-time">{formatDateTime(t.block_time)}</td>
                      <td className="address-cell">{t.from_address}</td>
                      <td className="address-cell">{t.to_address}</td>

                      {/* ✅ Best practice: prefer raw when available */}
                      <td className="col-amount">
                        {formatTokenPreferRaw(t.amount_raw ?? null, t.amount_bc400)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}