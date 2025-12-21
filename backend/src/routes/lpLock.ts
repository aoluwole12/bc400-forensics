import type { Express, Request, Response } from "express";
import { Contract, JsonRpcProvider, getAddress } from "ethers";

/**
 * Corrections added:
 * - safeChecksum always returns { ok:true, value } OR { ok:false, label, raw, error }
 * - decimals() fallback must be a number (uint8), not 18n
 * - validate pairRaw with isHexAddress BEFORE comparing to ZERO (case-insensitive)
 * - keep all checksummed comparisons consistent
 */

const DEFAULT_BC400 = "0x61Fc93c7C070B32B1b1479B86056d8Ec1D7125BD";
const RAW_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const RAW_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
}

function safeChecksum(label: string, raw: string) {
  const v = String(raw || "").trim();
  if (!isHexAddress(v)) {
    return { ok: false as const, label, raw: v, error: `invalid ${label} address` };
  }
  try {
    return { ok: true as const, label, raw: v, value: getAddress(v) };
  } catch (e) {
    return {
      ok: false as const,
      label,
      raw: v,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function getProvider() {
  const rpc =
    process.env.RPC_URL ||
    process.env.BSC_RPC_URL ||
    process.env.NODEREAL_HTTP ||
    "https://bsc-dataseed.binance.org/";
  return new JsonRpcProvider(rpc);
}

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address)",
];

function handleError(res: Response, where: string, err: unknown) {
  console.error(`Error in ${where}:`, err);
  res.status(500).json({
    error: `Failed to load ${where}`,
    details: err instanceof Error ? err.message : String(err),
  });
}

async function lpLockHandler(_req: Request, res: Response) {
  try {
    const RAW_BC400 = process.env.BC400_TOKEN_ADDRESS || DEFAULT_BC400;

    const bc400 = safeChecksum("BC400_TOKEN_ADDRESS", RAW_BC400);
    const wbnb = safeChecksum("WBNB", RAW_WBNB);
    const factoryAddr = safeChecksum("PANCAKESWAP_FACTORY", RAW_FACTORY);
    const deadAddr = safeChecksum("DEAD", DEAD);
    const zeroAddr = safeChecksum("ZERO", ZERO);

    const bad = [bc400, wbnb, factoryAddr, deadAddr, zeroAddr].find((x) => !x.ok);
    if (bad && !bad.ok) {
      return res.status(200).json({
        ok: false,
        pairFound: false,
        reason: `${bad.error}: "${bad.raw}"`,
        updatedAt: new Date().toISOString(),
      });
    }

    const BC400 = bc400.value;
    const WBNB = wbnb.value;
    const FACTORY = factoryAddr.value;
    const DEAD_ADDR = deadAddr.value;
    const ZERO_ADDR = zeroAddr.value;

    const provider = getProvider();
    const factory = new Contract(FACTORY, FACTORY_ABI, provider);

    const pairRaw: string = await factory.getPair(BC400, WBNB);
    const pairTrim = String(pairRaw || "").trim();

    // Validate pair string first (factory can return 0x000...0)
    if (!isHexAddress(pairTrim)) {
      return res.status(200).json({
        ok: false,
        pairFound: false,
        reason: `Factory returned invalid pair address: "${pairTrim}"`,
        updatedAt: new Date().toISOString(),
      });
    }

    // Compare against ZERO safely (case-insensitive)
    if (pairTrim.toLowerCase() === ZERO.toLowerCase()) {
      return res.json({
        ok: true,
        pairFound: false,
        reason: "No PancakeSwap v2 pair found",
        updatedAt: new Date().toISOString(),
      });
    }

    const pair = getAddress(pairTrim);
    const lp = new Contract(pair, ERC20_ABI, provider);

    const [symbol, decimalsRaw, totalSupply, deadBal, zeroBal] = await Promise.all([
      lp.symbol().catch(() => "LP"),
      // ✅ uint8 -> number fallback, not bigint
      lp.decimals().catch(() => 18),
      lp.totalSupply(),
      lp.balanceOf(DEAD_ADDR),
      lp.balanceOf(ZERO_ADDR),
    ]);

    const decimals = Number(decimalsRaw);
    const burned = (deadBal as bigint) + (zeroBal as bigint);
    const burnedPct =
      (totalSupply as bigint) > 0n
        ? Number(((burned * 1_000_000n) / (totalSupply as bigint))) / 10_000
        : 0;

    return res.json({
      ok: true,
      pairFound: true,
      dex: "PancakeSwap v2",
      pairAddress: pair,
      lp: { symbol, decimals },
      burn: {
        totalSupplyRaw: (totalSupply as bigint).toString(),
        burnedRaw: burned.toString(),
        burnedPct,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(res, "lp/lock", err);
  }
}

export function registerLpLockRoute(app: Express) {
  app.get("/lp/lock", lpLockHandler);
  app.get("/api/lp/lock", lpLockHandler);
}