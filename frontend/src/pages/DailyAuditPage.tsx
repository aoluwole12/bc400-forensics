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
  // ✅ IMPORTANT: remove TokenBurn import if your ../api/dailyAudit does not export it
  // TokenBurn,
} from "../api/dailyAudit";
import { fetchDailyAuditBundle } from "../api/dailyAudit";

// ✅ Local TokenBurn type to prevent TS2305 build error
type TokenBurn = {
  ok: boolean;
  reason?: string;
  tokenAddress?: string;
  token?: { symbol?: string; decimals?: number };
  supply?: {
    totalSupplyRaw?: string;
    burnedRaw?: string;
    circulatingRaw?: string;
    burnedPct?: number;
  };
  burnWallets?: { dead?: string; zero?: string };
  updatedAt?: string;
};

// ✅ NEW (1/5): “Adjusted/True Circulating” bundle payload (frontend-only, safe optional)
// Backend can return this under bundle.investorAdjusted (or you can rename later).
type InvestorAdjusted = {
  ok: boolean;
  reason?: string;

  // Step 1–3 outputs
  trueCirculatingRaw?: string; // recomputed “true circulating” in raw 18-decimal units

  // Step 4 output
  top10PctOfTrueCirculating?: number; // 0..100
  effectiveConcentrationPct?: number; // HHI*100 (0..100)
  effectiveHolders?: number; // ~1/HHI

  // Optional debug context
  excluded?: {
    burnedRaw?: string;
    lpRaw?: string;
    lockedRaw?: string;
  };

  updatedAt?: string;
};

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

// ✅ NEW (2/5): safer percent for numeric fields (already-number)
function safePctNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "-";
  if (!Number.isFinite(n) || n < 0) return "-";
  return `${n.toFixed(digits)}%`;
}

function looksIntString(v: any): boolean {
  const s = String(v ?? "").trim().replace(/,/g, "");
  return /^\d+$/.test(s);
}

// Convert huge bigint to a stable Number ratio without overflow (keeps relative shares)
function scaledRatio(numer: bigint, denom: bigint): number | null {
  if (denom <= 0n) return null;
  const a = numer.toString();
  const b = denom.toString();
  const keep = 15;
  const an = a.length > keep ? Number(a.slice(0, keep)) : Number(a);
  const bn = b.length > keep ? Number(b.slice(0, keep)) : Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn) || bn <= 0) return null;
  // adjust for different truncation lengths
  const exp = (a.length - Math.min(a.length, keep)) - (b.length - Math.min(b.length, keep));
  return (an / bn) * Math.pow(10, exp);
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

    const top20 = holders.slice(0, 20);
    const top10 = holders.slice(0, 10);

    let top10Sum = 0n;
    let top20Sum = 0n;
    let okRaw = true;

    for (const h of top10) {
      const raw =
        h.balance_raw && String(h.balance_raw).trim() !== "" ? String(h.balance_raw) : null;
      if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) {
        okRaw = false;
        break;
      }
      top10Sum += toBigIntSafe(raw);
    }

    if (okRaw) {
      for (const h of top20) {
        const raw =
          h.balance_raw && String(h.balance_raw).trim() !== "" ? String(h.balance_raw) : null;
        if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) {
          okRaw = false;
          break;
        }
        top20Sum += toBigIntSafe(raw);
      }
    }

    let top10Concentration = "-";
    if (okRaw && top20Sum > 0n) {
      const pctTimes1000 = (top10Sum * 100000n) / top20Sum;
      const pct = Number(pctTimes1000) / 1000;
      top10Concentration = `${pct.toFixed(1)}%`;
    }

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
      top10Concentration,
    };
  }, [holders, last24hTransfers]);

  const indexedBlock = summary?.lastIndexedBlock ?? null;

  const dex: DexPrice | null = bundle?.dexPrice ?? null;
  const lp: LpLock | null = bundle?.lpLock ?? null;
  const tokenBurn: TokenBurn | null = (bundle as any)?.tokenBurn ?? null;

  // ✅ NEW (3/5): read adjusted metrics (if backend sends it; otherwise cards show "-")
   //  const investorAdjusted: InvestorAdjusted | null = (bundle as any)?.investorAdjusted ?? null;
  const investorAdjusted: InvestorAdjusted | null =
  (bundle as any)?.investorAdjusted ??
  (bundle as any)?.concentrationAdjusted ??
  null;
   const adjustedLive = !!investorAdjusted && investorAdjusted.ok === true;

  const dexLive = !!dex && dex.ok === true;
  const lpLive = !!lp && lp.ok === true;
  const tokenLive = !!tokenBurn && tokenBurn.ok === true;

  const dexIssue = !!dex && dex.ok === false;
  const lpIssue = !!lp && lp.ok === false;
  const tokenIssue = !!tokenBurn && tokenBurn.ok === false;

  // Price from /dex/price (USD)
  const priceUsdNum =
    dexLive && dex?.priceUsd !== null && dex?.priceUsd !== undefined
      ? Number(String(dex.priceUsd).replace(/,/g, ""))
      : null;

  const priceUsdCard = dexLive ? safeUsd(dex?.priceUsd) : "-";

  // Token burn + circulating (token supply burn)
  const tokenBurnedPct = tokenLive ? safePct(tokenBurn?.supply?.burnedPct, 2) : "-";

  const circulatingRawOk = tokenLive && looksIntString(tokenBurn?.supply?.circulatingRaw);
  const circulatingRaw = circulatingRawOk
    ? toBigIntSafe(String(tokenBurn!.supply!.circulatingRaw))
    : 0n;

  const circulatingCard = circulatingRawOk
    ? `${formatFromRaw18(String(tokenBurn!.supply!.circulatingRaw), 6, 0)}`
    : "-";

  // ✅ NEW: total supply + REAL market cap + FDV
  const totalSupplyRawOk = tokenLive && looksIntString(tokenBurn?.supply?.totalSupplyRaw);
  const totalSupplyRaw = totalSupplyRawOk
    ? toBigIntSafe(String(tokenBurn!.supply!.totalSupplyRaw))
    : 0n;

  const circulatingNum =
    circulatingRawOk
      ? Number(formatFromRaw18(String(tokenBurn!.supply!.circulatingRaw), 12, 0).replace(/,/g, ""))
      : null;

  const totalSupplyNum =
    totalSupplyRawOk
      ? Number(formatFromRaw18(String(tokenBurn!.supply!.totalSupplyRaw), 12, 0).replace(/,/g, ""))
      : null;

  // REAL Market Cap (circulating): price × circulating supply
  const marketCapUsdNum =
    priceUsdNum && priceUsdNum > 0 && circulatingNum && circulatingNum > 0
      ? priceUsdNum * circulatingNum
      : null;

  // FDV: price × total supply
  const fdvUsdNum =
    priceUsdNum && priceUsdNum > 0 && totalSupplyNum && totalSupplyNum > 0
      ? priceUsdNum * totalSupplyNum
      : null;

  const marketCapUsdCard = marketCapUsdNum !== null ? safeUsd(marketCapUsdNum) : "-";
  const fdvUsdCard = fdvUsdNum !== null ? safeUsd(fdvUsdNum) : "-";

  // ✅ NEW (4/5): format adjusted (“true”) cards (do NOT touch existing eff/top10circ)
  const trueCirculatingCard =
    adjustedLive && looksIntString(investorAdjusted?.trueCirculatingRaw)
      ? `${formatFromRaw18(String(investorAdjusted!.trueCirculatingRaw), 6, 0)}`
      : "-";

  const top10PctTrueCircCard = adjustedLive
    ? safePctNum(investorAdjusted?.top10PctOfTrueCirculating ?? null, 2)
    : "-";

  const adjustedEffConcCard = adjustedLive
    ? `${safePctNum(investorAdjusted?.effectiveConcentrationPct ?? null, 2)}${
        Number.isFinite(investorAdjusted?.effectiveHolders as any)
          ? ` (≈${Number(investorAdjusted!.effectiveHolders!).toFixed(1)} effective holders)`
          : ""
      }`
    : "-";

  const adjustedEffHoldersCard =
    adjustedLive && Number.isFinite(investorAdjusted?.effectiveHolders as any)
      ? Number(investorAdjusted!.effectiveHolders!).toFixed(1)
      : "-";

  // LP burn (LP tokens burned)
  const lpBurnedPct = lpLive ? safePct(lp?.burn?.burnedPct, 2) : "-";

  const investorDerived = useMemo(() => {
    let top10PctOfCirc = "-";
    let effectiveConcentration = "-";
    let riskScore = "-";
    let riskBand = "-";

    if (!(circulatingRawOk && circulatingRaw > 0n)) {
      if (systemOnline) {
        let score = 0;
        if (!dexLive) score += 20;
        if (!tokenLive) score += 35;
        score = Math.max(0, Math.min(100, score));
        riskScore = String(score);
        riskBand =
          score <= 25 ? "LOW" : score <= 50 ? "MODERATE" : score <= 75 ? "HIGH" : "CRITICAL";
      }
      return { top10PctOfCirc, effectiveConcentration, riskScore, riskBand };
    }

    // --- Top-10 % of circulating ---
    const top10 = holders.slice(0, 10);
    let top10Sum = 0n;
    let okRaw = true;
    for (const h of top10) {
      const raw =
        h.balance_raw && String(h.balance_raw).trim() !== "" ? String(h.balance_raw) : null;
      if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) {
        okRaw = false;
        break;
      }
      top10Sum += toBigIntSafe(raw);
    }
    if (okRaw) {
      const pctTimes10000 = (top10Sum * 1000000n) / circulatingRaw; // 2dp
      const p = Number(pctTimes10000) / 10000;
      if (Number.isFinite(p)) top10PctOfCirc = `${p.toFixed(2)}%`;
    }

    // --- Effective concentration (HHI% + effective holders) using top20 shares of circulating ---
    const top20 = holders.slice(0, 20);
    let hhi = 0; // 0..1
    let shareSum = 0; // 0..1

    for (const h of top20) {
      const raw =
        h.balance_raw && String(h.balance_raw).trim() !== "" ? String(h.balance_raw) : null;
      if (!raw || !/^\d+$/.test(raw.replace(/,/g, ""))) continue;

      const bal = toBigIntSafe(raw);
      const share = scaledRatio(bal, circulatingRaw);
      if (share === null || !Number.isFinite(share) || share <= 0) continue;

      shareSum += share;
      hhi += share * share;
    }

    if (hhi > 0 && Number.isFinite(hhi)) {
      const effHolders = 1 / hhi;
      effectiveConcentration = `${(hhi * 100).toFixed(2)}% (≈${effHolders.toFixed(
        1
      )} effective holders)`;
    }

    // --- Risk score / band ---
    if (systemOnline) {
      let score = 0;

      if (!dexLive) score += 15;
      if (!tokenLive) score += 30;

      const p = Number(String(top10PctOfCirc).replace("%", ""));
      if (Number.isFinite(p)) {
        if (p >= 80) score += 35;
        else if (p >= 60) score += 25;
        else if (p >= 40) score += 12;
        else if (p >= 25) score += 6;
      } else {
        score += 10;
      }

      if (shareSum >= 0.9) score += 10;
      else if (shareSum >= 0.75) score += 6;

      const burnP = Number(String(tokenBurnedPct).replace("%", ""));
      if (Number.isFinite(burnP) && burnP >= 95) score += 5;

      score = Math.max(0, Math.min(100, score));
      riskScore = String(score);
      riskBand =
        score <= 25 ? "LOW" : score <= 50 ? "MODERATE" : score <= 75 ? "HIGH" : "CRITICAL";
    }

    return { top10PctOfCirc, effectiveConcentration, riskScore, riskBand };
  }, [circulatingRawOk, circulatingRaw, holders, systemOnline, dexLive, tokenLive, tokenBurnedPct]);

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
    { id: "top10", label: "Top-10\nconcentration", value: metrics.top10Concentration },
    { id: "indexer", label: "Indexer snapshot", value: indexedBlock ? formatNumber(indexedBlock) : "-" },
  ];

  // ✅ Investor Snapshot: relabel old MC to FDV and add real MC
  const investorCards: StatCardData[] = [
    { id: "t24", label: "Transfers (24h)\n(server)", value: formatNumber(last24hTransfers.length) },
    { id: "aw24", label: "Active wallets (24h)\n(server)", value: formatNumber(metrics.activeWallets) },

    { id: "pUsd", label: "Price (USD)\n(snapshot)", value: priceUsdCard },

    // ✅ NEW: Real Market Cap (circulating)
    { id: "mcReal", label: "Market Cap (USD)\n(circulating)", value: marketCapUsdCard },

    // ✅ Relabeled: FDV (total supply)
    { id: "fdv", label: "FDV (USD)\n(total supply)", value: fdvUsdCard },

    { id: "circ", label: "Circulating\n(snapshot)", value: circulatingCard },
    { id: "burned", label: "Token burned\n(snapshot)", value: tokenBurnedPct },

    { id: "risk", label: "Risk score\n(latest)", value: investorDerived.riskScore },
    { id: "band", label: "Risk band\n(latest)", value: investorDerived.riskBand },

    // ✅ DO NOT TOUCH existing “current” concentration cards:
    { id: "eff", label: "Effective\nconcentration", value: investorDerived.effectiveConcentration },
    { id: "top10circ", label: "Top-10 % of\ncirculating", value: investorDerived.top10PctOfCirc },

    // ✅ NEW (5/5): Add NEW “adjusted” cards (extra cards only)
    { id: "trueCirc", label: "True circulating\n(adjusted)", value: trueCirculatingCard },
    { id: "top10True", label: "Top-10 % of\ntrue circulating", value: top10PctTrueCircCard },
    { id: "effAdj", label: "Effective concentration\n(adjusted)", value: adjustedEffConcCard },
    { id: "effHAdj", label: "Adjusted effective\nholders", value: adjustedEffHoldersCard },
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
            <b>Adjusted metrics:</b> True circulating + adjusted concentration require backend exclusions
            (burn wallets + LP + locks). If backend hasn’t shipped it yet, these cards will show “-”.
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
            <b>Adjusted metrics status:</b> ok:false — {investorAdjusted.reason || "No reason provided"}
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