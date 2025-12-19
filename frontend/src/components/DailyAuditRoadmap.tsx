import React, { useEffect, useMemo, useState } from "react";

type Step = {
  title: string;
  status: "live" | "next" | "planned";
  description: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

/** ===== Backend shapes (make flexible + compatible) ===== */
type DexPriceResponse = {
  ok: boolean;
  dex?: string;
  pair?: string | null;
  token?: string;
  tokenSymbol?: string;
  reserves?: { token: number; wbnb: number };
  price?: { wbnb: number | null; usd: number | null; wbnbUsdUsed: number | null };
  marketCapUsd?: number | null;
  note?: string | null;
  error?: string;
  details?: string;
};

type LpLockResponse = {
  ok: boolean;
  pairFound?: boolean;

  // your backend uses pairAddress (not pair)
  pairAddress?: string;

  dex?: string;

  burn?: {
    burnedPct?: number;
    mode?: string; // "burned" | "not-burned" etc
    remainingPct?: number;
  };

  heuristic?: {
    mode?: "burned" | "possible-locker" | "verified-locker" | "unverified";
    primaryHolder?: string | null;
    primaryHolderIsContract?: boolean | null;
    note?: string;
  };

  risk?: {
    label?: "LOW" | "MEDIUM" | "HIGH";
    note?: string;
  };

  updatedAt?: string;

  // fallback
  note?: string | null;
  reason?: string;
  error?: string;
  details?: string;
};

type SecurityRulesResponse = {
  ok: boolean;

  // common fields you might return
  updatedAt?: string;

  // option A: rules array (recommended)
  rules?: Array<{
    id: string;
    label: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    passed: boolean;
    note?: string;
  }>;

  // option B: older/alternate shapes
  version?: string;
  signals?: {
    transfersLast24h?: number;
    newestIndexedTransfer?: { blockNumber: number; blockTime: string | null } | null;
  };
  notes?: string[];

  note?: string | null;
  error?: string;
  details?: string;
};

function shortAddr(a?: string | null) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function fmtNum(n: number, maxFrac = 6) {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

function fmtUsd(n: number | null | undefined) {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 8,
  });
}

function fmtCompactUsd(n: number | null | undefined) {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
}

export const DailyAuditRoadmap: React.FC = () => {
  const [dex, setDex] = useState<DexPriceResponse | null>(null);
  const [lp, setLp] = useState<LpLockResponse | null>(null);
  const [sec, setSec] = useState<SecurityRulesResponse | null>(null);

  const [dexErr, setDexErr] = useState<string | null>(null);
  const [lpErr, setLpErr] = useState<string | null>(null);
  const [secErr, setSecErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // DEX
      try {
        setDexErr(null);
        const r = await fetch(`${API_BASE}/dex/price`);
        if (!r.ok) throw new Error(`dex/price ${r.status}`);
        const j = (await r.json()) as DexPriceResponse;
        if (!cancelled) setDex(j);
      } catch (e: any) {
        if (!cancelled) setDexErr(String(e?.message || e));
      }

      // LP
      try {
        setLpErr(null);
        const r = await fetch(`${API_BASE}/lp/lock`);
        if (!r.ok) throw new Error(`lp/lock ${r.status}`);
        const j = (await r.json()) as LpLockResponse;
        if (!cancelled) setLp(j);
      } catch (e: any) {
        if (!cancelled) setLpErr(String(e?.message || e));
      }

      // Security
      try {
        setSecErr(null);
        const r = await fetch(`${API_BASE}/security/rules`);
        if (!r.ok) throw new Error(`security/rules ${r.status}`);
        const j = (await r.json()) as SecurityRulesResponse;
        if (!cancelled) setSec(j);
      } catch (e: any) {
        if (!cancelled) setSecErr(String(e?.message || e));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const steps: Step[] = useMemo(() => {
    // 1) Live audit (always real)
    const liveDesc = "Built from live API data: /health, /summary, /top-holders, /transfers.";

    // 2) DEX
    let dexDesc = "Loading DEX pair + price…";
    if (dexErr) dexDesc = `DEX endpoint unavailable (${dexErr}).`;
    else if (dex) {
      if (!dex.pair) {
        dexDesc = dex.note || "No PancakeSwap v2 pair found for token/WBNB.";
      } else {
        const wbnb = dex.price?.wbnb;
        const usd = dex.price?.usd;
        const mcap = dex.marketCapUsd;

        const parts: string[] = [];
        parts.push(`DEX: ${dex.dex || "PancakeSwapV2"}`);
        parts.push(`Pair: ${shortAddr(dex.pair)}`);
        if (dex.tokenSymbol) parts.push(`Token: ${dex.tokenSymbol}`);
        if (wbnb !== null && wbnb !== undefined) parts.push(`Price: ${fmtNum(wbnb, 10)} WBNB`);
        if (usd !== null && usd !== undefined) parts.push(`≈ ${fmtUsd(usd)}`);
        if (mcap !== null && mcap !== undefined) parts.push(`MC: ${fmtCompactUsd(mcap)} USD`);
        if (!usd) parts.push(`(USD/MC needs WBNB_USD env on backend)`);

        dexDesc = parts.join(" • ");
      }
    }

    // 3) LP lock (your backend shape)
    let lpDesc = "Loading LP burn + lock heuristic…";
    if (lpErr) lpDesc = `LP endpoint unavailable (${lpErr}).`;
    else if (lp) {
      const pairFound = lp.pairFound ?? Boolean(lp.pairAddress);
      if (!pairFound) {
        lpDesc = lp.reason || lp.note || "No PancakeSwap v2 pair found for BC400/WBNB.";
      } else {
        const pairAddr = lp.pairAddress;
        const burnedPct = lp.burn?.burnedPct;
        const mode = lp.heuristic?.mode || lp.burn?.mode;
        const risk = lp.risk?.label;

        const parts: string[] = [];
        if (pairAddr) parts.push(`Pair: ${shortAddr(pairAddr)}`);
        if (typeof burnedPct === "number") parts.push(`LP Burned: ${burnedPct.toFixed(2)}%`);

        if (mode === "verified-locker") {
          parts.push(`Locker: VERIFIED`);
        } else if (mode === "possible-locker") {
          const ph = lp.heuristic?.primaryHolder;
          const isC = lp.heuristic?.primaryHolderIsContract;
          parts.push(
            `Locker: possible-locker (${isC ? "contract" : "wallet"}${ph ? ` ${shortAddr(ph)}` : ""})`
          );
        } else if (mode === "burned") {
          parts.push(`Mode: burned`);
        } else {
          parts.push(`Locker: not verified`);
        }

        if (risk) parts.push(`Risk: ${risk}`);

        lpDesc = parts.join(" • ");
      }
    }

    // 4) Security rules (support multiple backend shapes)
    let secDesc = "Loading security signals…";
    if (secErr) secDesc = `Security endpoint unavailable (${secErr}).`;
    else if (sec?.rules && Array.isArray(sec.rules)) {
      const total = sec.rules.length;
      const passed = sec.rules.filter((r) => r.passed).length;
      const failed = total - passed;

      // show the most important failing rule first (HIGH > MEDIUM > LOW)
      const sevRank = (s: string) => (s === "HIGH" ? 3 : s === "MEDIUM" ? 2 : 1);
      const worstFail = sec.rules
        .filter((r) => !r.passed)
        .sort((a, b) => sevRank(b.severity) - sevRank(a.severity))[0];

      const parts: string[] = [];
      parts.push(`Rules: ${passed}/${total} passed`);
      if (failed > 0 && worstFail) parts.push(`Top issue: ${worstFail.label} (${worstFail.severity})`);
      secDesc = parts.join(" • ");
    } else if (sec?.signals) {
      const parts: string[] = [];
      parts.push(`v${sec.version || "1"}`);
      if (typeof sec.signals.transfersLast24h === "number") {
        parts.push(`Transfers (24h): ${sec.signals.transfersLast24h.toLocaleString()}`);
      }
      if (sec.signals.newestIndexedTransfer?.blockNumber) {
        parts.push(`Newest indexed: #${sec.signals.newestIndexedTransfer.blockNumber.toLocaleString()}`);
      }
      secDesc = parts.join(" • ");
    } else if (sec?.ok) {
      secDesc = sec.note || "Security endpoint online, but no rules/signals returned.";
    }

    return [
      { title: "Live Audit (Now)", status: "live", description: liveDesc },
      { title: "DEX Pair + Price/MC (Live)", status: "next", description: dexDesc },
      { title: "LP Lock Monitor (live)", status: "next", description: lpDesc },
      { title: "Security Rules Engine (LIVE)", status: "planned", description: secDesc },
    ];
  }, [dex, lp, sec, dexErr, lpErr, secErr]);

  return (
    <div className="roadmap">
      <div className="roadmap-title">Daily Audit Roadmap</div>
      <div className="roadmap-grid">
        {steps.map((s) => (
          <div
            key={s.title}
            className={
              s.status === "live"
                ? "roadmap-card roadmap-card--live"
                : s.status === "next"
                ? "roadmap-card roadmap-card--next"
                : "roadmap-card"
            }
          >
            <div className="roadmap-top">
              <span className="roadmap-dot" />
              <span className="roadmap-name">{s.title}</span>
              <span className="roadmap-tag">
                {s.status === "live" ? "LIVE" : s.status === "next" ? "NEXT" : "PLANNED"}
              </span>
            </div>
            <div className="roadmap-desc">{s.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};