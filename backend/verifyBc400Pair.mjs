import "dotenv/config";
import { ethers } from "ethers";

const RPC = process.env.BSC_RPC_URL || process.env.BSC_RPC_HTTP || process.env.BSC_RPC_HTTP_URL;
if (!RPC) throw new Error("Set BSC_RPC_URL in .env");

const provider = new ethers.JsonRpcProvider(RPC);

const token = (process.env.BC400_TOKEN_ADDRESS || process.env.TOKEN_ADDRESS || "").toLowerCase();
if (!token) throw new Error("Set BC400_TOKEN_ADDRESS in .env");

const pair = (process.argv[2] || "").toLowerCase();
if (!pair) throw new Error("Usage: node verifyBc400Pair.mjs <pairAddress>");

const PairABI = [
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

const FactoryABI = [
  "function getPair(address tokenA, address tokenB) view returns (address)",
];

const PANCAKESWAP_V2_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

function norm(a){ return String(a||"").toLowerCase(); }

const code = await provider.getCode(pair);
console.log("PAIR:", pair);
console.log("Contract bytecode:", code && code !== "0x" ? "YES ✅" : "NO ❌");
if (!code || code === "0x") process.exit(0);

const c = new ethers.Contract(pair, PairABI, provider);

const factory = norm(await c.factory());
const token0 = norm(await c.token0());
const token1 = norm(await c.token1());
const reserves = await c.getReserves();

console.log("factory():", factory, factory === PANCAKESWAP_V2_FACTORY ? "(PancakeV2 ✅)" : "(NOT PancakeV2 ❌)");
console.log("token0(): ", token0, token0 === token ? "(BC400 ✅)" : "");
console.log("token1(): ", token1, token1 === token ? "(BC400 ✅)" : "");
console.log("reserves:", reserves.reserve0.toString(), reserves.reserve1.toString());

if (factory === PANCAKESWAP_V2_FACTORY) {
  const f = new ethers.Contract(PANCAKESWAP_V2_FACTORY, FactoryABI, provider);

  // If BC400 is token0, token1 is the other side, and vice versa
  const other = token0 === token ? token1 : token1 === token ? token0 : null;

  if (!other) {
    console.log("❌ This pair does NOT contain BC400 as token0/token1.");
  } else {
    const fromFactory = norm(await f.getPair(token, other));
    console.log("factory.getPair(BC400, other):", fromFactory, fromFactory === pair ? "(CONFIRMED ✅)" : "(NOT THIS PAIR ❌)");
  }
}
