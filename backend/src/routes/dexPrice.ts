import type { Express } from "express";
import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_BC400 = "0x61Fc93c7C070B32B1b1479B86056d8Ec1D7125BD";
const DEFAULT_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const PANCAKE_V2_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

// ✅ Chainlink BNB/USD on BSC (override with env if you ever want)
const DEFAULT_BNB_USD_FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
}

function checksumOrNull(raw: string) {
  const v = String(raw || "").trim();
  if (!isHexAddress(v)) return null;
  try {
    return getAddress(v);
  } catch {
    return null;
  }
}

function isZeroAddress(a: string) {
  return String(a || "").toLowerCase() === ZERO.toLowerCase();
}

function getProvider() {
  const rpc =
    process.env.BSC_RPC_URL ||
    process.env.RPC_URL ||
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

const CHAINLINK_AGG_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
];

// ✅ UPDATED: safer Chainlink parsing (avoid Number(bigint) directly)
async function getBnbUsd(provider: JsonRpcProvider) {
  // 1) Optional fallback override (not required)
  if (process.env.WBNB_USD) {
    const n = Number(process.env.WBNB_USD);
    if (Number.isFinite(n) && n > 0) {
      return { bnbUsd: n, source: "env:WBNB_USD" as const };
    }
  }

  // 2) Live Chainlink feed
  const feedAddr =
    checksumOrNull(process.env.BNB_USD_FEED || "") ?? getAddress(DEFAULT_BNB_USD_FEED);

  const feed = new Contract(feedAddr, CHAINLINK_AGG_ABI, provider);

  const [dec, round] = await Promise.all([feed.decimals(), feed.latestRoundData()]);

  const answer = round?.[1] as bigint; // int256
  if (typeof answer !== "bigint" || answer <= 0n) {
    return { bnbUsd: null as number | null, source: "chainlink:invalid" as const };
  }

  const d = Number(dec);
  if (!Number.isFinite(d) || d < 0 || d > 36) {
    return { bnbUsd: null as number | null, source: "chainlink:bad_decimals" as const };
  }

  // Convert: answer / 10^d into a JS number with bounded precision
  const scale = 10n ** BigInt(d);
  const whole = answer / scale;
  const frac = answer % scale;

  // keep up to 8 decimals for UI
  const fracStr = frac.toString().padStart(d, "0").slice(0, 8);
  const num = Number(`${whole.toString()}.${fracStr || "0"}`);

  if (!Number.isFinite(num) || num <= 0) {
    return { bnbUsd: null as number | null, source: "chainlink:parse_fail" as const };
  }

  return { bnbUsd: num, source: `chainlink:${feedAddr}` as const };
}

export function registerDexPriceRoute(app: Express) {
  async function handler(_req: any, res: any) {
    try {
      const warnings: string[] = [];
      const provider = getProvider();

      const BC400 =
        checksumOrNull(process.env.BC400_TOKEN_ADDRESS || DEFAULT_BC400) ??
        getAddress(DEFAULT_BC400);

      const WBNB =
        checksumOrNull(process.env.WBNB_TOKEN_ADDRESS || DEFAULT_WBNB) ??
        getAddress(DEFAULT_WBNB);

      // 1) Prefer configured pair, but ignore ZERO
      const configuredPairRaw = checksumOrNull(process.env.BC400_PAIR_ADDRESS || "");
      const configuredPair =
        configuredPairRaw && !isZeroAddress(configuredPairRaw) ? configuredPairRaw : null;

      let pair: string | null = configuredPair;

      // 2) Fallback: discover via factory
      if (!pair) {
        const factory = new Contract(PANCAKE_V2_FACTORY, FACTORY_ABI, provider);
        const found: string = await factory.getPair(BC400, WBNB);
        const foundTrim = String(found || "").trim();

        if (!isHexAddress(foundTrim) || foundTrim.toLowerCase() === ZERO.toLowerCase()) {
          return res.json({
            ok: true,
            dex: "PancakeSwap v2",
            pairAddress: null,
            token: BC400,
            priceWbnb: null,
            bnbUsd: null,
            bnbUsdSource: null,
            priceUsd: null,
            fdvUsd: null,

            // deprecated compatibility field (FDV-style)
            marketCapUsd: null,
            marketCapUsdNote: "Deprecated: this endpoint returns FDV-style valuation. Use fdvUsd.",

            reason: "No PancakeSwap v2 pair found for BC400/WBNB",
            warnings,
            updatedAt: new Date().toISOString(),
          });
        }

        pair = getAddress(foundTrim);
      }

      // Load pair reserves + token0/token1
      const pairC = new Contract(pair, PAIR_ABI, provider);
      const [token0Raw, token1Raw, reserves] = await Promise.all([
        pairC.token0(),
        pairC.token1(),
        pairC.getReserves(),
      ]);

      const token0 = getAddress(String(token0Raw));
      const token1 = getAddress(String(token1Raw));

      // Validate that pair contains BC400 + WBNB
      const hasBC400 = token0 === BC400 || token1 === BC400;
      const hasWBNB = token0 === WBNB || token1 === WBNB;

      if (!hasBC400 || !hasWBNB) {
        warnings.push(`Pair tokens mismatch (token0=${token0}, token1=${token1})`);
        return res.status(200).json({
          ok: true,
          dex: "PancakeSwap v2",
          pairAddress: pair,
          token: BC400,
          tokenSymbol: "BC400",
          priceWbnb: null,
          bnbUsd: null,
          bnbUsdSource: null,
          priceUsd: null,
          fdvUsd: null,

          // deprecated compatibility field (FDV-style)
          marketCapUsd: null,
          marketCapUsdNote: "Deprecated: this endpoint returns FDV-style valuation. Use fdvUsd.",

          warnings,
          reason: "Configured/discovered pair does not match BC400/WBNB",
          updatedAt: new Date().toISOString(),
        });
      }

      const [r0, r1] = reserves as [bigint, bigint, number];

      const bcIs0 = token0 === BC400;
      const bcReserveRaw = bcIs0 ? r0 : r1;
      const wbnbReserveRaw = bcIs0 ? r1 : r0;

      const bc = new Contract(BC400, ERC20_ABI, provider);
      const wbnb = new Contract(WBNB, ERC20_ABI, provider);

      const [tokenSymbol, tokenDecimals, wbnbDecimals, tokenSupply] = await Promise.all([
        bc.symbol().catch(() => "BC400"),
        bc.decimals().catch(() => 18),
        wbnb.decimals().catch(() => 18),
        bc.totalSupply().catch(() => 0n),
      ]);

      const bcReserve = Number(formatUnits(bcReserveRaw, tokenDecimals));
      const wbnbReserve = Number(formatUnits(wbnbReserveRaw, wbnbDecimals));

      const priceWbnb = bcReserve > 0 ? wbnbReserve / bcReserve : null;

      // ✅ live BNB/USD (chainlink) (no static price env needed)
      const { bnbUsd, source: bnbUsdSource } = await getBnbUsd(provider);
      const priceUsd = priceWbnb !== null && bnbUsd ? priceWbnb * bnbUsd : null;

      // ✅ FDV (total supply valuation)
      const supplyFloat = Number(formatUnits(tokenSupply as bigint, tokenDecimals));
      const fdvUsd = priceUsd !== null ? supplyFloat * priceUsd : null;

      return res.json({
        ok: true,
        dex: "PancakeSwap v2",
        pairAddress: pair,
        token: BC400,
        tokenSymbol,

        // price feed
        priceWbnb,
        bnbUsd,
        bnbUsdSource,
        priceUsd,

        // ✅ explicit: total-supply valuation
        fdvUsd,

        // ✅ keep old name for compatibility but mark it deprecated (it equals FDV)
        marketCapUsd: fdvUsd,
        marketCapUsdNote:
          "Deprecated: this field equals FDV (priceUsd * totalSupply). Real market cap requires circulating supply from /token/burn.",

        // audit-grade raw fields
        totalSupplyRaw: (tokenSupply as bigint).toString(),
        reservesRaw: {
          bc400: bcReserveRaw.toString(),
          wbnb: wbnbReserveRaw.toString(),
        },
        reserves: {
          token: bcReserve,
          wbnb: wbnbReserve,
        },

        warnings,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Error in /dex/price:", err);
      return res.status(500).json({
        ok: false,
        error: "Failed to compute dex price",
        details: String(err?.message || err),
      });
    }
  }

  app.get("/dex/price", handler);
  app.get("/api/dex/price", handler);
}