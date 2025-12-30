// frontend/src/pages/DailyAuditPage.tsx
import { useEffect, useMemo, useState } from "react";
import "../index.css";
import { Header } from "../components/Header";
import { DailyAuditRoadmap } from "../components/DailyAuditRoadmap";
import StatsGrid, { StatCardData } from "../components/StatsGrid";
import DailyAuditLayout from "../components/daily-audit/DailyAuditLayout";

import type {
  DailyAuditBundle,
  DexPrice,
  LpLock,
  Summary,
  Holder,
  Transfer,
  TokenBurn,
  InvestorAdjusted,
} from "../api/dailyAudit";

import { fetchDailyAuditBundle } from "../api/dailyAudit";

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

    return frac.length ? `${neg ? "-" : ""}${whole}.${frac}` : `${neg ? "-" : ""}${whole}`;
  }

  return input;
}

function formatNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return formatHumanDecimal(String(value), 6, 0);
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

function parseISO(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shortAddr(a?: string) {
  if (!a) return "-";
  const s = String(a);
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function safeUsd(v: any): string {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `$${formatHumanDecimal(String(n), 8, 2)}`;
}

function safePct(v: any, digits = 2): string {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return "-";
  return `${n.toFixed(digits)}%`;
}

function safePctNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "-";
  if (!Number.isFinite(n) || n < 0) return "-";
  return `${n.toFixed(digits)}%`;
}

function looksIntString(v: any): boolean {
  const s = String(v ?? "").trim().replace(/,/g, "");
  return /^\d+$/.test(s);
}

export default function DailyAuditPage() {
  const [bundle, setBundle] = useState<DailyAuditBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const b = await fetchDailyAuditBundle();
      setBundle(b);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error("Daily audit load failed:", e);
      setBundle(null);
      setRefreshKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const systemOnline = bundle?.systemOnline ?? false;
  const summary: Summary | null = bundle?.summary ?? null;
  const holders: Holder[] = bundle?.holders ?? [];
  const transfers: Transfer[] = bundle?.transfers24h ?? [];
  const lastUpdatedISO = bundle?.lastUpdatedISO ?? null;

  const { last24hTransfers, windowLabel } = useMemo(() => {
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;

    const within = transfers.filter((t) => {
      const d = parseISO(t.block_time);
      if (!d) return false;
      return d.getTime() >= cutoff && d.getTime() <= now;
    });

    return { last24hTransfers: within, windowLabel: "Last 24H" };
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
    const transferVolume = rawCount > 0 ? formatFromRaw18(sumRaw.toString(), 6, 2) : "-";

    // top20 used for whale flows
    const top20 = holders.slice(0, 20);
    const topHolderSet = new Set(top20.map((h) => h.address.toLowerCase()));

    let whaleIn = 0n;
    let whaleOut = 0n;

    for (const t of last24hTransfers) {
      const raw =
        t.amount_raw && String(t.amount_raw).trim() !== "" ? String(t.amount_raw) : null;
      if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) continue;

      const fromIs = topHolderSet.has((t.from_address || "").toLowerCase());
      const toIs = topHolderSet.has((t.to_address || "").toLowerCase());

      if (toIs && !fromIs) whaleIn += toBigIntSafe(raw);
      if (fromIs && !toIs) whaleOut += toBigIntSafe(raw);
    }

    const whaleNetFlow = formatFromRaw18((whaleIn - whaleOut).toString(), 6, 2);

    return {
      activeWallets: walletSet.size,
      transferVolume,
      whaleNetFlow,
    };
  }, [holders, last24hTransfers]);

  const indexedBlock = summary?.lastIndexedBlock ?? null;

  const dex: DexPrice | null = bundle?.dexPrice ?? null;
  const lp: LpLock | null = bundle?.lpLock ?? null;
  const tokenBurn: TokenBurn | null = bundle?.tokenBurn ?? null;

  const investorAdjusted: InvestorAdjusted | null =
    bundle?.investorAdjusted ??
    (bundle as any)?.concentrationAdjusted ??
    (bundle as any)?.investorConcentration ??
    null;

  const adjustedLive = !!investorAdjusted && investorAdjusted.ok === true;

  const dexLive = !!dex && dex.ok === true;
  const lpLive = !!lp && lp.ok === true;
  const tokenLive = !!tokenBurn && tokenBurn.ok === true;

  const dexIssue = !!dex && dex.ok === false;
  const lpIssue = !!lp && lp.ok === false;
  const tokenIssue = !!tokenBurn && tokenBurn.ok === false;

  // ✅ NEW: Risk is now injected by backend into /daily-audit response
  const riskLatest = bundle?.dailyAudit?.risk?.latest ?? null;

  const riskScoreCard =
    riskLatest?.score !== null && riskLatest?.score !== undefined ? String(riskLatest.score) : "-";

  const riskBandCard = riskLatest?.band ? String(riskLatest.band).toUpperCase() : "-";

  // Price from /dex/price (USD)
  const priceUsdNum =
    dexLive && dex?.priceUsd !== null && dex?.priceUsd !== undefined
      ? Number(String(dex.priceUsd).replace(/,/g, ""))
      : null;

  const priceUsdCard = dexLive ? safeUsd(dex?.priceUsd) : "-";

  // Token burn + circulating
  const tokenBurnedPct = tokenLive ? safePct(tokenBurn?.supply?.burnedPct, 2) : "-";

  const circulatingRawOk = tokenLive && looksIntString(tokenBurn?.supply?.circulatingRaw);
  const circulatingCard = circulatingRawOk
    ? `${formatFromRaw18(String(tokenBurn!.supply!.circulatingRaw), 6, 0)}`
    : "-";

  // Total supply + market cap + FDV
  const totalSupplyRawOk = tokenLive && looksIntString(tokenBurn?.supply?.totalSupplyRaw);

  const circulatingNum =
    circulatingRawOk
      ? Number(formatFromRaw18(String(tokenBurn!.supply!.circulatingRaw), 12, 0).replace(/,/g, ""))
      : null;

  const totalSupplyNum =
    totalSupplyRawOk
      ? Number(formatFromRaw18(String(tokenBurn!.supply!.totalSupplyRaw), 12, 0).replace(/,/g, ""))
      : null;

  const marketCapUsdNum =
    priceUsdNum && priceUsdNum > 0 && circulatingNum && circulatingNum > 0
      ? priceUsdNum * circulatingNum
      : null;

  const fdvUsdNum =
    priceUsdNum && priceUsdNum > 0 && totalSupplyNum && totalSupplyNum > 0
      ? priceUsdNum * totalSupplyNum
      : null;

  const marketCapUsdCard = marketCapUsdNum !== null ? safeUsd(marketCapUsdNum) : "-";
  const fdvUsdCard = fdvUsdNum !== null ? safeUsd(fdvUsdNum) : "-";

  const trueCirculatingCard =
    adjustedLive && looksIntString(investorAdjusted?.trueCirculatingRaw)
      ? `${formatFromRaw18(String(investorAdjusted!.trueCirculatingRaw), 6, 0)}`
      : "-";

  const top10PctTrueCircCard = adjustedLive
    ? safePctNum(investorAdjusted?.top10PctOfTrueCirculating ?? null, 2)
    : "-";

  const effConcCard = adjustedLive
    ? `${safePctNum(investorAdjusted?.effectiveConcentrationPct ?? null, 2)}${
        Number.isFinite(investorAdjusted?.effectiveHolders as any)
          ? ` (≈${Number(investorAdjusted!.effectiveHolders!).toFixed(1)} effective holders)`
          : ""
      }`
    : "-";

  const effHoldersCard =
    adjustedLive && Number.isFinite(investorAdjusted?.effectiveHolders as any)
      ? Number(investorAdjusted!.effectiveHolders!).toFixed(1)
      : "-";

  const lpBurnedPct = lpLive ? safePct(lp?.burn?.burnedPct, 2) : "-";

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
    { id: "window", label: "Transfers Window", value: windowLabel },
  ];

  const confidenceCards: StatCardData[] = [
    { id: "active-wallets", label: "Active wallets", value: formatNumber(metrics.activeWallets) },
    { id: "volume", label: "Transfer volume\n(BC400)", value: metrics.transferVolume },
    { id: "total-wallets", label: "Total wallets", value: formatNumber(summary?.totalWallets ?? null) },
    { id: "whale-net", label: "Whale net flow\n(BC400)", value: metrics.whaleNetFlow },
    { id: "indexer", label: "Indexer snapshot", value: indexedBlock ? formatNumber(indexedBlock) : "-" },
  ];

  const investorCards: StatCardData[] = [
    { id: "t24", label: "Transfers (24h)\n(server)", value: formatNumber(last24hTransfers.length) },
    { id: "aw24", label: "Active wallets (24h)\n(server)", value: formatNumber(metrics.activeWallets) },

    { id: "pUsd", label: "Price (USD)\n(snapshot)", value: priceUsdCard },

    { id: "mcReal", label: "Market Cap (USD)\n(circulating)", value: marketCapUsdCard },
    { id: "fdv", label: "FDV (USD)\n(total supply)", value: fdvUsdCard },

    { id: "circ", label: "Circulating\n(snapshot)", value: circulatingCard },
    { id: "burned", label: "Token burned\n(snapshot)", value: tokenBurnedPct },

    { id: "risk", label: "Risk score\n(latest)", value: riskScoreCard },
    { id: "band", label: "Risk band\n(latest)", value: riskBandCard },

    { id: "trueCirc", label: "True circulating", value: trueCirculatingCard },
    { id: "top10True", label: "Top-10 % of\ntrue circulating", value: top10PctTrueCircCard },
    { id: "effConc", label: "Effective concentration", value: effConcCard },
    { id: "effH", label: "Effective holders", value: effHoldersCard },
  ];

  const whaleCards: StatCardData[] = [
    { id: "whale-net-2", label: "Top holder net flow", value: `${metrics.whaleNetFlow} BC400` },
  ];

  const holderCards: StatCardData[] = [
    { id: "active-wallets-2", label: "Active wallets", value: formatNumber(metrics.activeWallets) },
    { id: "total-wallets-2", label: "Total wallets now", value: formatNumber(summary?.totalWallets ?? null) },
  ];

  return (
    <DailyAuditLayout>
      <Header />

      <section className="panel panel--status panel--audit-status">
        <div className="panel-block">
          <div className="panel-header-row">
            <h2 className="panel-title">Daily BC400 Audit Report</h2>
          </div>

          <p className="panel-muted">
            Live recap derived from your existing API: <b>/health</b>, <b>/summary</b>,{" "}
            <b>/top-holders</b>, <b>/transfers/latest</b>
          </p>

          <div className="daily-audit-header-grid">
            <StatsGrid stats={statusCards} columns={3} />
          </div>
        </div>

        <div className="daily-audit-actions">
          <button type="button" className="pill-action-btn" onClick={() => window.history.back()}>
            ← Back to dashboard
          </button>

          <button type="button" className="pill-action-btn" onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header-row">
          <h2 className="panel-title">Confidence Signals</h2>
          <span className="panel-caption">{systemOnline ? "API Online" : "API Offline"}</span>
        </div>

        <div style={{ marginTop: 8 }}>
          <StatsGrid stats={confidenceCards} />
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header-row">
          <h2 className="panel-title">Investor Snapshot</h2>
          <span className="panel-caption">From /dex/price + /token/burn + server 24h window</span>
        </div>

        <div style={{ marginTop: 8 }}>
          <StatsGrid stats={investorCards} />
        </div>

        <div className="panel-muted" style={{ marginTop: 10 }}>
          <b>Sources:</b> Price from <b>/dex/price</b> · Circulating + Total supply + Burn% from{" "}
          <b>/token/burn</b> · Market Cap = price × circulating · FDV = price × total supply · LP burn shown in{" "}
          <b>Liquidity</b> (<b>/lp/lock</b>).
          <div style={{ marginTop: 6 }}>
            <b>True circulating + concentration:</b> requires backend exclusions (burn wallets + LP + locks).
            If backend hasn’t shipped it yet, these cards will show “-”.
          </div>
        </div>

        {(dexIssue || tokenIssue) && (
          <div className="panel-muted" style={{ marginTop: 10 }}>
            <b>Snapshot warnings:</b>{" "}
            {dexIssue ? `DEX: ${dex?.reason || "ok:false"}` : ""}
            {dexIssue && tokenIssue ? " · " : ""}
            {tokenIssue ? `TOKEN: ${tokenBurn?.reason || "ok:false"}` : ""}
          </div>
        )}

        {!!investorAdjusted && !adjustedLive && (
          <div className="panel-muted" style={{ marginTop: 10 }}>
            <b>True metrics status:</b> ok:false — {investorAdjusted.reason || "No reason provided"}
          </div>
        )}
      </section>

      <section className="panel panel--table">
        <div className="panel-header-row">
          <h2 className="panel-title">Daily Audit</h2>
          <span className="panel-caption">Live + next + planned modules</span>
        </div>

        <div style={{ marginTop: 10 }}>
          <DailyAuditRoadmap
            systemOnline={systemOnline}
            indexedBlock={indexedBlock}
            transfers24hCount={last24hTransfers.length}
            refreshKey={refreshKey}
          />
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header-row">
          <h2 className="panel-title">Liquidity</h2>
          <span className="panel-caption">{lpLive ? "Live from /lp/lock" : "Endpoint status"}</span>
        </div>

        <div className="panel-muted">
          {lpLive ? (
            <>
              <div>
                <b>Pair:</b> {shortAddr(lp?.pairAddress)}{" "}
                {lp?.expectedPairAddress ? (
                  <>
                    {" · "}
                    <b>Expected:</b> {shortAddr(lp.expectedPairAddress)}
                  </>
                ) : null}
              </div>

              <div style={{ marginTop: 6 }}>
                <b>LP Burned:</b> {lpBurnedPct} {" · "} <b>Locker:</b> not verified
              </div>

              {Array.isArray(lp?.warnings) && lp.warnings.length > 0 ? (
                <div style={{ marginTop: 6 }}>
                  <b>Warnings:</b> {lp.warnings.join(" · ")}
                </div>
              ) : null}

              <div style={{ marginTop: 10 }}>
                <b>Note:</b> LP Burned ≠ Token Burn. Token burn % is shown in <b>Investor Snapshot</b>.
              </div>
            </>
          ) : lpIssue ? (
            <>
              <b>ISSUE:</b> /lp/lock returned ok:false — {lp?.reason || "No reason provided"}
            </>
          ) : (
            <>
              Not yet available from current endpoints.
              <div style={{ marginTop: 6 }}>
                To make this investor-grade, we’ll add on-chain DEX pair detection + locker detection
                (PinkLock/Unicrypt/TeamFinance, etc) then show:
                <ul>
                  <li>Pair address + DEX (PancakeSwap v2/v3) + reserves</li>
                  <li>LP lock %, unlock date(s), and locker contract verification</li>
                  <li>Alerts on unlocks, liquidity pulls, ownership changes</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header-row">
          <h2 className="panel-title">Whale Activity</h2>
          <span className="panel-caption">Based on top-holders + transfers (Last 24h)</span>
        </div>

        <div style={{ marginTop: 8 }}>
          <StatsGrid stats={whaleCards} />
        </div>
      </section>

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
    </DailyAuditLayout>
  );
}