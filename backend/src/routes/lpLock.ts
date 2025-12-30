import type { Express, Request, Response } from "express";
import { Contract, JsonRpcProvider, getAddress } from "ethers";

const DEFAULT_BC400 = "0x61Fc93c7C070B32B1b1479B86056d8Ec1D7125BD";
const DEFAULT_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const DEFAULT_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

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
  // ✅ matches your .env
  const rpc = process.env.BSC_RPC_URL || process.env.RPC_URL || "https://bsc-dataseed.binance.org/";
  return new JsonRpcProvider(rpc);
}

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

function handleError(res: Response, where: string, err: unknown) {
  console.error(`Error in ${where}:`, err);
  res.status(500).json({
    ok: false,
    error: `Failed to load ${where}`,
    details: err instanceof Error ? err.message : String(err),
  });
}

async function lpLockHandler(_req: Request, res: Response) {
  try {
    const warnings: string[] = [];

    const RAW_BC400 = process.env.BC400_TOKEN_ADDRESS || DEFAULT_BC400;
    const RAW_WBNB = process.env.WBNB_TOKEN_ADDRESS || DEFAULT_WBNB; // optional env
    const RAW_FACTORY = process.env.PANCAKESWAP_V2_FACTORY || DEFAULT_FACTORY; // optional env

    const bc400 = safeChecksum("BC400_TOKEN_ADDRESS", RAW_BC400);
    const wbnb = safeChecksum("WBNB_TOKEN_ADDRESS", RAW_WBNB);
    const factoryAddr = safeChecksum("PANCAKESWAP_V2_FACTORY", RAW_FACTORY);
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

    if (!isHexAddress(pairTrim)) {
      return res.status(200).json({
        ok: false,
        pairFound: false,
        reason: `Factory returned invalid pair address: "${pairTrim}"`,
        updatedAt: new Date().toISOString(),
      });
    }

    if (pairTrim.toLowerCase() === ZERO.toLowerCase()) {
      return res.json({
        ok: true,
        pairFound: false,
        dex: "PancakeSwap v2",
        reason: "No PancakeSwap v2 pair found",
        updatedAt: new Date().toISOString(),
      });
    }

    const pair = getAddress(pairTrim);

    // ✅ investor-grade: confirm the pair is BC400/WBNB
    const pairC = new Contract(pair, PAIR_ABI, provider);
    const [token0, token1] = await Promise.all([pairC.token0(), pairC.token1()]);
    const t0 = getAddress(String(token0));
    const t1 = getAddress(String(token1));

    if (!((t0 === BC400 && t1 === WBNB) || (t0 === WBNB && t1 === BC400))) {
      return res.status(200).json({
        ok: false,
        pairFound: true,
        dex: "PancakeSwap v2",
        pairAddress: pair,
        reason: `Pair tokens mismatch (token0=${t0}, token1=${t1})`,
        updatedAt: new Date().toISOString(),
      });
    }

    // ✅ warn if configured pair doesn’t match factory
    const expectedPairRaw = String(process.env.BC400_PAIR_ADDRESS || "").trim();
    if (expectedPairRaw && isHexAddress(expectedPairRaw)) {
      const expectedPair = getAddress(expectedPairRaw);
      if (pair.toLowerCase() !== expectedPair.toLowerCase()) {
        warnings.push(`Factory pair mismatch: expected ${expectedPair} but got ${pair}`);
      }
    }

    const lp = new Contract(pair, ERC20_ABI, provider);

    const [symbol, decimalsRaw, totalSupply, deadBal, zeroBal] = await Promise.all([
      lp.symbol().catch(() => "LP"),
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
      expectedPairAddress:
        expectedPairRaw && isHexAddress(expectedPairRaw) ? getAddress(expectedPairRaw) : null,
      warnings,
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