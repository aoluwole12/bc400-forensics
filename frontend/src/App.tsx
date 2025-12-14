import { useEffect, useState } from "react";
import "./index.css";

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
  tx_count: number;
  first_seen: string | null;
  last_seen: string | null;
};

type Transfer = {
  block_number: number;
  block_time: string | null;
  from_address: string;
  to_address: string;
  amount_bc400: string | null;
};

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";

  const str = String(value);

  // If it's all digits, add commas manually so we don't overflow Number
  if (/^\d+$/.test(str)) {
    return str.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  const num = Number(str);
  if (Number.isNaN(num)) return str;

  return num.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
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

// -------- Normalizers: adapt whatever the backend sends --------

function normalizeHolder(raw: any, index: number): Holder {
  return {
    rank: raw.rank ?? raw.position ?? raw.index ?? index + 1,
    address: raw.address ?? raw.wallet ?? "",
    balance_bc400: raw.balance_bc400 ?? raw.balance ?? raw.balanceRaw ?? "0",
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
    // look at raw_amount/rawAmount as well
    amount_bc400:
      raw.amount_bc400 ??
      raw.amount ??
      raw.value ??
      raw.raw_amount ??
      raw.rawAmount ??
      null,
  };
}

export default function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [healthMessage, setHealthMessage] = useState<string>("Checking...");
  const [healthOk, setHealthOk] = useState<boolean>(false);

  useEffect(() => {
    async function load() {
      try {
        const [healthRes, summaryRes, holdersRes, transfersRes] =
          await Promise.all([
            fetch(`${API_BASE}/health`),
            fetch(`${API_BASE}/summary`),
            fetch(`${API_BASE}/top-holders`),
            fetch(`${API_BASE}/transfers`),
          ]);

        // Health (API)
        if (healthRes.ok) {
          const h = await healthRes.json();
          setHealthOk(true);
          setHealthMessage(h.status || "Connected to backend successfully.");
        } else {
          setHealthOk(false);
          setHealthMessage(`HTTP ${healthRes.status}`);
        }

        // Summary (indexer)
        if (summaryRes.ok) {
          const s = await summaryRes.json();
          setSummary(s);
        }

        // Top holders – array or {holders: [...]} or {items: [...]}
        if (holdersRes.ok) {
          const data = await holdersRes.json();
          let raw: any[] = [];

          if (Array.isArray(data)) {
            raw = data;
          } else if (Array.isArray(data.holders)) {
            raw = data.holders;
          } else if (Array.isArray(data.items)) {
            raw = data.items;
          }

          const normalized = raw.map((h, idx) => normalizeHolder(h, idx));
          setHolders(normalized);
        }

        // Transfers – array or {transfers: [...]} or {items: [...]}
        if (transfersRes.ok) {
          const data = await transfersRes.json();
          let raw: any[] = [];

          if (Array.isArray(data)) {
            raw = data;
          } else if (Array.isArray(data.transfers)) {
            raw = data.transfers;
          } else if (Array.isArray(data.items)) {
            raw = data.items;
          }

          const normalized = raw.map((t) => normalizeTransfer(t));
          setTransfers(normalized);
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
        setHealthOk(false);
        setHealthMessage("Failed to reach backend.");
      }
    }

    load();
  }, []);

  const top20 = holders.slice(0, 20);
  const last20Transfers = transfers.slice(0, 20);

  // Derived status flags for the SYSTEM HEALTH card
  const indexerOnline = !!summary;
  const apiOnline = healthOk;

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="app-header">
          <div>
            <h1 className="app-title">#BC400 FORENSICS</h1>
            <p className="app-subtitle">
              Live on-chain activity &amp; security intel for BC400 holders.
            </p>
          </div>
          {/* right side currently empty – indexer pill moved into System Health */}
        </header>

        {/* Index + system health */}
        <section className="panel panel--status">
          <div className="panel-block panel-block--index">
            <h2 className="panel-title panel-title--index">BC400 Status</h2>
            {summary ? (
              <dl className="stats-grid stats-grid--hero">
                <div>
                  <dt>First Block</dt>
                  <dd>{formatNumber(summary.firstBlock)}</dd>
                </div>
                <div>
                  <dt>Last Indexed </dt>
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
            <h2 className="panel-title panel-title--system">SYSTEM HEALTH</h2>
            <div className="health-status-row">
              <span className="health-label">Indexer:</span>
              <span
                className={
                  indexerOnline
                    ? "health-value health-value--ok"
                    : "health-value health-value--bad"
                }
              >
                {indexerOnline ? "Online" : "Offline"}
              </span>

              <span className="health-label health-label--spacer">
                API Base:
              </span>
              <span
                className={
                  apiOnline
                    ? "health-value health-value--ok"
                    : "health-value health-value--bad"
                }
              >
                {apiOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </section>

        {/* Top holders */}
        <section className="panel panel--table">
          <div className="panel-header-row">
            <h2 className="panel-title">Top Holders</h2>
            <span className="panel-caption">
              Showing top {top20.length} wallets
            </span>
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
                      <td className="col-balance">
                        {formatNumber(h.balance_bc400)}
                      </td>
                      <td className="col-tx">
                        {formatNumber(h.tx_count ?? 0)}
                      </td>
                      <td className="col-tags">none</td>
                      <td className="col-time">
                        {formatDateTime(h.first_seen)}
                      </td>
                      <td className="col-time">
                        {formatDateTime(h.last_seen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent transfers */}
        <section className="panel panel--table panel--recent">
          <div className="panel-header-row">
            <h2 className="panel-title">Recent Transfers</h2>
            <span className="panel-caption">
              Latest {last20Transfers.length} indexed transfers
            </span>
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
                    <tr
                      key={`${t.block_number}-${idx}-${t.from_address}-${t.to_address}`}
                    >
                      <td className="col-block">
                        {formatNumber(t.block_number)}
                      </td>
                      <td className="col-time">
                        {formatDateTime(t.block_time)}
                      </td>
                      <td className="address-cell">{t.from_address}</td>
                      <td className="address-cell">{t.to_address}</td>
                      <td className="col-amount">
                        {t.amount_bc400 === null
                          ? "-"
                          : formatNumber(t.amount_bc400)}
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
