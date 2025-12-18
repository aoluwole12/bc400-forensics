import type { Express } from "express";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";

const BC400_TOKEN = "0x61fc93c7c070b32b1b1479b86056d8ec1d7125bd";
const WBNB_TOKEN = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const PANCAKE_V2_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
const ZERO = "0x0000000000000000000000000000000000000000";

function getProvider() {
  const rpc =
    process.env.RPC_URL ||
    process.env.BSC_RPC_URL ||
    process.env.NODEREAL_HTTP_URL ||
    "https://bsc-dataseed.binance.org/";
  return new JsonRpcProvider(rpc);
}

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

export function registerDexPriceRoute(app: Express) {
  async function handler(_req: any, res: any) {
    try {
      const provider = getProvider();
      const factory = new Contract(PANCAKE_V2_FACTORY, FACTORY_ABI, provider);

      const pair: string = await factory.getPair(BC400_TOKEN, WBNB_TOKEN);
      if (!pair || pair.toLowerCase() === ZERO) {
        return res.json({
          ok: true,
          dex: "PancakeSwap v2",
          pair: null,
          note: "No PancakeSwap v2 pair found for BC400/WBNB",
          updatedAt: new Date().toISOString(),
        });
      }

      const pairC = new Contract(pair, PAIR_ABI, provider);
      const [token0, token1, reserves] = await Promise.all([
        pairC.token0(),
        pairC.token1(),
        pairC.getReserves(),
      ]);

      const [r0, r1] = reserves as [bigint, bigint, number];

      // identify which reserve is BC400 vs WBNB
      const t0 = String(token0).toLowerCase();
      const t1 = String(token1).toLowerCase();

      const bcIs0 = t0 === BC400_TOKEN;
      const bcReserve = bcIs0 ? r0 : r1;
      const wbnbReserve = bcIs0 ? r1 : r0;

      const bc = new Contract(BC400_TOKEN, ERC20_ABI, provider);
      const wbnb = new Contract(WBNB_TOKEN, ERC20_ABI, provider);

      const [tokenSymbol, tokenDecimals, wbnbDecimals, tokenSupply] = await Promise.all([
        bc.symbol().catch(() => "BC400"),
        bc.decimals().catch(() => 18),
        wbnb.decimals().catch(() => 18),
        bc.totalSupply().catch(() => 0n),
      ]);

      const bcFloat = Number(formatUnits(bcReserve, tokenDecimals));
      const wbnbFloat = Number(formatUnits(wbnbReserve, wbnbDecimals));

      const priceWbnb = bcFloat > 0 ? wbnbFloat / bcFloat : null;

      const wbnbUsd = process.env.WBNB_USD ? Number(process.env.WBNB_USD) : null;
      const priceUsd = priceWbnb !== null && wbnbUsd ? priceWbnb * wbnbUsd : null;

      const supplyFloat = Number(formatUnits(tokenSupply as bigint, tokenDecimals));
      const marketCapUsd = priceUsd !== null ? supplyFloat * priceUsd : null;

      return res.json({
        ok: true,
        dex: "PancakeSwap v2",
        pair: pair.toLowerCase(),
        token: BC400_TOKEN,
        tokenSymbol,
        price: {
          wbnb: priceWbnb,
          usd: priceUsd,
          wbnbUsdUsed: wbnbUsd,
        },
        marketCapUsd,
        reserves: {
          token: bcFloat,
          wbnb: wbnbFloat,
        },
        note: wbnbUsd ? null : "Set WBNB_USD env to compute USD + MarketCap",
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Error in /dex/price:", err);
      return res.status(500).json({
        error: "Failed to compute dex price",
        details: String(err?.message || err),
      });
    }
  }

  app.get("/dex/price", handler);
  app.get("/api/dex/price", handler);
}