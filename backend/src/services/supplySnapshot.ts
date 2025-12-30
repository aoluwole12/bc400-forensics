import type { Pool } from "pg";
import { ethers } from "ethers";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

const CHAINLINK_AGG_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

function mustAddr(label: string, v?: string) {
  const val = (v ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(val)) {
    throw new Error(`Missing/invalid ${label}: "${val}"`);
  }
  return val;
}

function addrOrEmpty(v?: string) {
  const val = (v ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(val) ? val : "";
}

function sameAddr(a?: string, b?: string) {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

export type SupplySnapshotInsert = {
  token_address: string;
  ts: Date;
  total_supply_raw: string;
  burned_raw: string;
  lp_raw: string;
  locked_raw: string;
  circulating_raw: string;
  price_usd: string | null;
  marketcap_usd: string | null;
  metadata: any;
};

export type InsertSupplySnapshotResult = {
  snapshot: SupplySnapshotInsert;
  inserted: boolean;
  reason?: string;
};

export async function buildSupplySnapshot(): Promise<{ snapshot: SupplySnapshotInsert }> {
  const rpcUrl = (process.env.BSC_RPC_URL || "").trim();
  if (!rpcUrl) throw new Error("Missing BSC_RPC_URL");

  const tokenAddress = mustAddr("BC400_TOKEN_ADDRESS", process.env.BC400_TOKEN_ADDRESS);
  const pairAddress = mustAddr("BC400_PAIR_ADDRESS", process.env.BC400_PAIR_ADDRESS);

  const treasury = addrOrEmpty(process.env.BC400_TREASURY_WALLET);
  const devburn = addrOrEmpty(process.env.BC400_DEV_BURN_WALLET);
  const lockedAddr = addrOrEmpty(process.env.BC400_LOCKED_ADDRESS);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

  const [name, symbol, decimalsBN, totalSupply] = await Promise.all([
    token.name().catch(() => "Unknown"),
    token.symbol().catch(() => "UNKNOWN"),
    token.decimals().catch(() => 18),
    token.totalSupply(),
  ]);

  const tokenDecimals = Number(decimalsBN);

  // -----------------------
  // Burn math (avoid double-counting)
  // -----------------------
  // Always include DEAD and ZERO
  // Include devburn ONLY if it's not the same as DEAD/ZERO
  const includeDevburn =
    devburn && !sameAddr(devburn, DEAD) && !sameAddr(devburn, ZERO);

  const [deadBal, zeroBal, lpBal, devburnBal, lockedBal] = await Promise.all([
    token.balanceOf(DEAD),
    token.balanceOf(ZERO),
    token.balanceOf(pairAddress),
    includeDevburn ? token.balanceOf(devburn) : Promise.resolve(0n),
    lockedAddr ? token.balanceOf(lockedAddr) : Promise.resolve(0n),
  ]);

  const burnedRaw: bigint = deadBal + zeroBal + devburnBal;
  const lockedRaw: bigint = lockedBal;

  let circulatingRaw: bigint = totalSupply - burnedRaw - lpBal - lockedRaw;
  if (circulatingRaw < 0n) circulatingRaw = 0n;

  // -----------------------
  // Price (token in WBNB -> USD)
  // -----------------------
  const wbnb = (process.env.WBNB_ADDRESS || DEFAULT_WBNB).toLowerCase();

  const [token0, token1, reserves] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.getReserves(),
  ]);

  const t0 = String(token0).toLowerCase();
  const t1 = String(token1).toLowerCase();
  const tokenLower = tokenAddress.toLowerCase();

  const reserve0 = BigInt(reserves[0].toString());
  const reserve1 = BigInt(reserves[1].toString());

  let priceInWbnb: number | null = null;
  if (reserve0 > 0n && reserve1 > 0n) {
    // use formatUnits to avoid overflow
    if (t0 === tokenLower && t1 === wbnb) {
      const rToken = parseFloat(ethers.formatUnits(reserve0, tokenDecimals));
      const rWbnb = parseFloat(ethers.formatUnits(reserve1, 18));
      if (rToken > 0) priceInWbnb = rWbnb / rToken;
    } else if (t1 === tokenLower && t0 === wbnb) {
      const rToken = parseFloat(ethers.formatUnits(reserve1, tokenDecimals));
      const rWbnb = parseFloat(ethers.formatUnits(reserve0, 18));
      if (rToken > 0) priceInWbnb = rWbnb / rToken;
    }
  }

  // Chainlink BNB/USD
  const bnbUsdFeed = (process.env.BNB_USD_FEED || "").trim();
  let bnbUsd: number | null = null;

  if (bnbUsdFeed) {
    const feed = new ethers.Contract(bnbUsdFeed, CHAINLINK_AGG_ABI, provider);
    const [round, feedDecimals] = await Promise.all([
      feed.latestRoundData(),
      feed.decimals(),
    ]);

    const ans = BigInt(round[1].toString());
    if (ans > 0n) {
      bnbUsd = Number(ans) / Math.pow(10, Number(feedDecimals));
    }
  }

  const priceUsd =
    priceInWbnb != null && bnbUsd != null ? priceInWbnb * bnbUsd : null;

  const circulatingHuman = parseFloat(
    ethers.formatUnits(circulatingRaw, tokenDecimals)
  );

  const marketcapUsd =
    priceUsd != null && Number.isFinite(circulatingHuman)
      ? priceUsd * circulatingHuman
      : null;

  const metadata = {
    name,
    symbol,
    decimals: tokenDecimals,
    tokenAddress,
    pairAddress,
    token0: t0,
    token1: t1,
    reserve0: reserve0.toString(),
    reserve1: reserve1.toString(),
    wbnbAddress: wbnb,
    bnbUsdFeed: bnbUsdFeed || null,
    treasury: treasury || null,
    devburn: includeDevburn ? devburn : null,
    devburnSkippedBecauseOverlap: devburn && !includeDevburn ? devburn : null,
    lockedAddress: lockedAddr || null,
    computed: { priceInWbnb, bnbUsd },
  };

  const snapshot: SupplySnapshotInsert = {
    token_address: tokenAddress,
    ts: new Date(),
    total_supply_raw: totalSupply.toString(),
    burned_raw: burnedRaw.toString(),
    lp_raw: lpBal.toString(),
    locked_raw: lockedRaw.toString(),
    circulating_raw: circulatingRaw.toString(),
    price_usd: priceUsd != null ? String(priceUsd) : null,
    marketcap_usd: marketcapUsd != null ? String(marketcapUsd) : null,
    metadata,
  };

  return { snapshot };
}

async function getLatestSnapshot(pool: Pool, tokenAddress: string) {
  const r = await pool.query<{
    total_supply_raw: string;
    burned_raw: string;
    lp_raw: string;
    locked_raw: string;
    circulating_raw: string;
    price_usd: string | null;
    marketcap_usd: string | null;
  }>(
    `
    SELECT
      total_supply_raw,
      burned_raw,
      lp_raw,
      locked_raw,
      circulating_raw,
      price_usd,
      marketcap_usd
    FROM public.supply_snapshots
    WHERE token_address = $1
    ORDER BY ts DESC
    LIMIT 1
    `,
    [tokenAddress]
  );

  return r.rows[0] ?? null;
}

function asBig(v: string | null | undefined) {
  return BigInt((v ?? "0").toString());
}

export async function insertSupplySnapshot(pool: Pool): Promise<InsertSupplySnapshotResult> {
  const { snapshot } = await buildSupplySnapshot();

  // -----------------------
  // Guard rails
  // -----------------------
  const total = asBig(snapshot.total_supply_raw);
  const burned = asBig(snapshot.burned_raw);
  const lp = asBig(snapshot.lp_raw);
  const locked = asBig(snapshot.locked_raw);
  const circ = asBig(snapshot.circulating_raw);

  if (total <= 0n) return { snapshot, inserted: false, reason: "total_supply_raw <= 0" };
  if (burned > total) return { snapshot, inserted: false, reason: "burned_raw > total_supply_raw" };
  if (lp > total) return { snapshot, inserted: false, reason: "lp_raw > total_supply_raw" };
  if (locked > total) return { snapshot, inserted: false, reason: "locked_raw > total_supply_raw" };
  if (circ <= 0n) return { snapshot, inserted: false, reason: "circulating_raw <= 0" };

  // -----------------------
  // Dedupe: if latest snapshot has same key values, skip insert
  // -----------------------
  const latest = await getLatestSnapshot(pool, snapshot.token_address);
  if (latest) {
    const same =
      asBig(latest.total_supply_raw) === total &&
      asBig(latest.burned_raw) === burned &&
      asBig(latest.lp_raw) === lp &&
      asBig(latest.locked_raw) === locked &&
      asBig(latest.circulating_raw) === circ &&
      (latest.price_usd ?? null) === (snapshot.price_usd ?? null);

    if (same) {
      return { snapshot, inserted: false, reason: "duplicate snapshot (no changes)" };
    }
  }

  await pool.query(
    `
    INSERT INTO public.supply_snapshots (
      token_address,
      ts,
      total_supply_raw,
      burned_raw,
      lp_raw,
      locked_raw,
      circulating_raw,
      price_usd,
      marketcap_usd,
      metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      snapshot.token_address,
      snapshot.ts,
      snapshot.total_supply_raw,
      snapshot.burned_raw,
      snapshot.lp_raw,
      snapshot.locked_raw,
      snapshot.circulating_raw,
      snapshot.price_usd,
      snapshot.marketcap_usd,
      snapshot.metadata,
    ]
  );

  return { snapshot, inserted: true };
}