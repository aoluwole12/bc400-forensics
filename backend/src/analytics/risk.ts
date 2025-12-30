// backend/src/analytics/risk.ts
type RiskBand = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type RiskInputs = {
  // concentration (best source is adjusted true circulating analytics)
  top10PctTrue?: number | null;               // 0..100
  effectiveConcentrationPct?: number | null;  // HHI*100, 0..100
  effectiveHolders?: number | null;           // ~1/HHI

  // tokenomics / supply
  tokenBurnedPct?: number | null;             // 0..100

  // liquidity / locks (if available)
  lpBurnedPct?: number | null;                // 0..100
  lpLockPct?: number | null;                  // 0..100 (if you can compute)
  lpUnlockTs?: string | null;                 // optional ISO/ts string

  // activity
  transfers24h?: number | null;
  activeWallets24h?: number | null;
  whaleNetFlow24hRaw?: string | null;         // raw 18dp string if you have it; optional

  // data confidence / indexing
  indexerLagBlocks?: number | null;           // chainHead - lastIndexedBlock
  dexLive?: boolean;
  tokenLive?: boolean;
  lpLive?: boolean;
};

export type RiskResult = {
  score: number;        // 0..100
  band: RiskBand;
  reasons: string[];    // human readable bullets
  signals: Record<string, any>; // raw signals for UI/debug
  updatedAt: string;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function bandFromScore(score: number): RiskBand {
  if (score <= 25) return "LOW";
  if (score <= 50) return "MODERATE";
  if (score <= 75) return "HIGH";
  return "CRITICAL";
}

export function computeRisk(i: RiskInputs): RiskResult {
  let score = 0;
  const reasons: string[] = [];

  // ----------------------------
  // 0) DATA RELIABILITY PENALTY
  // ----------------------------
  if (i.dexLive === false) { score += 12; reasons.push("DEX price unavailable (reduced confidence)."); }
  if (i.tokenLive === false) { score += 18; reasons.push("Token supply/burn unavailable (reduced confidence)."); }
  if (i.lpLive === false) { score += 10; reasons.push("LP/lock status unavailable (liquidity risk unknown)."); }

  // Indexer lag: > 2k blocks ≈ stale (tune if needed)
  if (typeof i.indexerLagBlocks === "number" && Number.isFinite(i.indexerLagBlocks)) {
    if (i.indexerLagBlocks > 5000) { score += 18; reasons.push(`Indexer lag is high (${i.indexerLagBlocks} blocks).`); }
    else if (i.indexerLagBlocks > 2000) { score += 12; reasons.push(`Indexer lag is moderate (${i.indexerLagBlocks} blocks).`); }
    else if (i.indexerLagBlocks > 500) { score += 6; reasons.push(`Indexer lag is small (${i.indexerLagBlocks} blocks).`); }
  }

  // ----------------------------
  // 1) CONCENTRATION RISK
  // ----------------------------
  // Top10% true circulating
  if (typeof i.top10PctTrue === "number" && Number.isFinite(i.top10PctTrue)) {
    const p = i.top10PctTrue;
    if (p >= 80) { score += 28; reasons.push(`Extreme top-10 concentration (${p.toFixed(2)}%).`); }
    else if (p >= 60) { score += 22; reasons.push(`High top-10 concentration (${p.toFixed(2)}%).`); }
    else if (p >= 40) { score += 14; reasons.push(`Moderate top-10 concentration (${p.toFixed(2)}%).`); }
    else if (p >= 25) { score += 8; reasons.push(`Some top-10 concentration (${p.toFixed(2)}%).`); }
  } else {
    score += 10;
    reasons.push("Top-10 concentration not available (can’t quantify whale control).");
  }

  // Effective concentration (HHI%)
  if (typeof i.effectiveConcentrationPct === "number" && Number.isFinite(i.effectiveConcentrationPct)) {
    const h = i.effectiveConcentrationPct;
    // For HHI%: higher = fewer effective holders
    if (h >= 5) { score += 20; reasons.push(`Very high effective concentration (HHI ${h.toFixed(2)}%).`); }
    else if (h >= 2) { score += 14; reasons.push(`High effective concentration (HHI ${h.toFixed(2)}%).`); }
    else if (h >= 1) { score += 8; reasons.push(`Moderate effective concentration (HHI ${h.toFixed(2)}%).`); }
  }

  // Effective holders: low count = risk
  if (typeof i.effectiveHolders === "number" && Number.isFinite(i.effectiveHolders)) {
    const eh = i.effectiveHolders;
    if (eh < 10) { score += 18; reasons.push(`Very low effective holders (≈${eh.toFixed(1)}).`); }
    else if (eh < 25) { score += 12; reasons.push(`Low effective holders (≈${eh.toFixed(1)}).`); }
    else if (eh < 60) { score += 6; reasons.push(`Moderate effective holders (≈${eh.toFixed(1)}).`); }
  }

  // ----------------------------
  // 2) LIQUIDITY / LOCK RISK
  // ----------------------------
  // LP burned reduces rug risk a bit (but not full safety)
  if (typeof i.lpBurnedPct === "number" && Number.isFinite(i.lpBurnedPct)) {
    const lpB = i.lpBurnedPct;
    if (lpB >= 95) { score -= 6; reasons.push(`LP burned is high (${lpB.toFixed(2)}%) (reduces rug risk).`); }
    else if (lpB >= 80) { score -= 3; reasons.push(`LP burned is moderate (${lpB.toFixed(2)}%).`); }
    else { score += 6; reasons.push(`LP burned is low (${lpB.toFixed(2)}%) (liquidity removal risk).`); }
  }

  // LP lock percent (if you compute it)
  if (typeof i.lpLockPct === "number" && Number.isFinite(i.lpLockPct)) {
    const lk = i.lpLockPct;
    if (lk >= 90) { score -= 6; reasons.push(`LP lock is high (${lk.toFixed(2)}%).`); }
    else if (lk >= 60) { score -= 2; reasons.push(`LP lock is moderate (${lk.toFixed(2)}%).`); }
    else { score += 10; reasons.push(`LP lock is low (${lk.toFixed(2)}%) (unlock/liquidity pull risk).`); }
  }

  // ----------------------------
  // 3) SUPPLY / TOKENOMIC SIGNALS
  // ----------------------------
  if (typeof i.tokenBurnedPct === "number" && Number.isFinite(i.tokenBurnedPct)) {
    const b = i.tokenBurnedPct;
    // very high burn usually implies low circulating / thin liquidity sensitivity
    if (b >= 97) { score += 4; reasons.push(`Very high burn (${b.toFixed(2)}%) can amplify volatility.`); }
    else if (b >= 90) { score += 2; reasons.push(`High burn (${b.toFixed(2)}%) suggests limited float.`); }
  }

  // ----------------------------
  // 4) ACTIVITY / MANIPULATION RISK
  // ----------------------------
  // Low activity + high concentration = easier manipulation
  const t24 = typeof i.transfers24h === "number" ? i.transfers24h : null;
  const w24 = typeof i.activeWallets24h === "number" ? i.activeWallets24h : null;

  if (t24 !== null && w24 !== null) {
    if (t24 < 20 && w24 < 15) { score += 12; reasons.push("Very low activity (easy to manipulate price)."); }
    else if (t24 < 50 && w24 < 30) { score += 7; reasons.push("Low activity (manipulation risk elevated)."); }
  }

  // ----------------------------
  // Normalize score + band
  // ----------------------------
  score = clamp(Math.round(score), 0, 100);
  const band = bandFromScore(score);

  return {
    score,
    band,
    reasons,
    signals: {
      top10PctTrue: i.top10PctTrue ?? null,
      effectiveConcentrationPct: i.effectiveConcentrationPct ?? null,
      effectiveHolders: i.effectiveHolders ?? null,
      tokenBurnedPct: i.tokenBurnedPct ?? null,
      lpBurnedPct: i.lpBurnedPct ?? null,
      lpLockPct: i.lpLockPct ?? null,
      transfers24h: t24,
      activeWallets24h: w24,
      indexerLagBlocks: i.indexerLagBlocks ?? null,
      dexLive: i.dexLive ?? null,
      tokenLive: i.tokenLive ?? null,
      lpLive: i.lpLive ?? null,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * ✅ NEW EXPORT:
 * Used by backend/src/routes/dailyAudit.ts
 * It takes the /daily-audit JSON bundle and converts it into RiskInputs.
 */
export function computeRiskFromDailyAudit(daily: any): RiskResult {
  const adjusted = daily?.concentrationAdjusted ?? null;

  const inputs: RiskInputs = {
    // these keys match your /daily-audit output
    top10PctTrue: adjusted?.top10PctOfTrueCirculating ?? null,
    effectiveConcentrationPct: adjusted?.effectiveConcentrationPct ?? null,
    effectiveHolders: adjusted?.effectiveHolders ?? null,

    // available from /daily-audit transfers section
    transfers24h: daily?.transfers?.txs24h ?? null,
    activeWallets24h: daily?.transfers?.activeWallets24h ?? null,

    // optional – only if you later include them in the daily bundle
    tokenBurnedPct: daily?.tokenBurn?.supply?.burnedPct ?? null,
    lpBurnedPct: daily?.lpLock?.burn?.burnedPct ?? null,

    // leave null unless you compute these elsewhere
    lpLockPct: null,
    lpUnlockTs: null,
    whaleNetFlow24hRaw: null,
    indexerLagBlocks: null,
    dexLive: null,
    tokenLive: null,
    lpLive: null,
  };

  return computeRisk(inputs);
}