import type { Express, Request, Response } from "express";
import { Contract, JsonRpcProvider, getAddress } from "ethers";

/**
 * IMPORTANT:
 * - Do NOT checksum at module load time
 * - ethers v6 throws immediately on invalid checksum
 */

const RAW_BC400 =
  process.env.BC400_TOKEN_ADDRESS ||
  "0x61Fc93c7C070B32B1b1479B86056d8Ec1D7125BD";

const RAW_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const RAW_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";

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
    // ✅ checksum ONLY inside handler
    const BC400 = getAddress(RAW_BC400);
    const WBNB = getAddress(RAW_WBNB);
    const FACTORY = getAddress(RAW_FACTORY);
    const DEAD_ADDR = getAddress(DEAD);
    const ZERO_ADDR = getAddress(ZERO);

    const provider = getProvider();
    const factory = new Contract(FACTORY, FACTORY_ABI, provider);

    const pairRaw: string = await factory.getPair(BC400, WBNB);

    if (!pairRaw || pairRaw === ZERO_ADDR) {
      return res.json({
        ok: true,
        pairFound: false,
        reason: "No PancakeSwap v2 pair found",
        updatedAt: new Date().toISOString(),
      });
    }

    const pair = getAddress(pairRaw);
    const lp = new Contract(pair, ERC20_ABI, provider);

    const [symbol, decimalsRaw, totalSupply, deadBal, zeroBal] =
      await Promise.all([
        lp.symbol().catch(() => "LP"),
        lp.decimals().catch(() => 18n),
        lp.totalSupply(),
        lp.balanceOf(DEAD_ADDR),
        lp.balanceOf(ZERO_ADDR),
      ]);

    const decimals = Number(decimalsRaw);
    const burned = deadBal + zeroBal;
    const burnedPct =
      totalSupply > 0n ? Number((burned * 1000000n) / totalSupply) / 10000 : 0;

    return res.json({
      ok: true,
      pairFound: true,
      dex: "PancakeSwap v2",
      pairAddress: pair,
      lp: { symbol, decimals },
      burn: {
        totalSupplyRaw: totalSupply.toString(),
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
