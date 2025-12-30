import type { Express, Request, Response } from "express";
import { Contract, JsonRpcProvider, getAddress } from "ethers";

const DEFAULT_BC400 = "0x61Fc93c7C070B32B1b1479B86056d8Ec1D7125BD";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
}

function getProvider() {
  const rpc =
    process.env.BSC_RPC_URL ||
    process.env.RPC_URL ||
    process.env.BSC_RPC_HTTP_URL ||
    process.env.NODEREAL_HTTP_URL ||
    "https://bsc-dataseed.binance.org/";
  return new JsonRpcProvider(rpc);
}

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

async function handler(_req: Request, res: Response) {
  try {
    const rawToken = String(process.env.BC400_TOKEN_ADDRESS || DEFAULT_BC400).trim();
    if (!isHexAddress(rawToken)) {
      return res.status(200).json({
        ok: false,
        reason: `Invalid BC400_TOKEN_ADDRESS: "${rawToken}"`,
        updatedAt: new Date().toISOString(),
      });
    }

    const token = getAddress(rawToken);
    const provider = getProvider();
    const erc20 = new Contract(token, ERC20_ABI, provider);

    const [symbol, decimalsRaw, totalSupply, deadBal, zeroBal] = await Promise.all([
      erc20.symbol().catch(() => "BC400"),
      erc20.decimals().catch(() => 18),
      erc20.totalSupply(),
      erc20.balanceOf(getAddress(DEAD)),
      erc20.balanceOf(getAddress(ZERO)),
    ]);

    const decimals = Number(decimalsRaw);
    const burned = (deadBal as bigint) + (zeroBal as bigint);

    const burnedPct =
      (totalSupply as bigint) > 0n
        ? Number(((burned * 1_000_000n) / (totalSupply as bigint))) / 10_000
        : 0;

    const circulating = (totalSupply as bigint) - burned;

    return res.json({
      ok: true,
      tokenAddress: token,
      token: { symbol, decimals },
      supply: {
        totalSupplyRaw: (totalSupply as bigint).toString(),
        burnedRaw: burned.toString(),
        circulatingRaw: circulating.toString(),
        burnedPct,
      },
      burnWallets: {
        dead: getAddress(DEAD),
        zero: getAddress(ZERO),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error in /token/burn:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load token burn",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export function registerTokenBurnRoute(app: Express) {
  app.get("/token/burn", handler);
  app.get("/api/token/burn", handler);
}