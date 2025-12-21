import "dotenv/config";
import { ethers } from "ethers";

const pair = (process.argv[2] || "").toLowerCase();
if (!pair) {
  throw new Error("Usage: node -r dotenv/config verifyPair.mjs <pairAddress>");
}

const RPC = process.env.BSC_RPC_URL;
if (!RPC) throw new Error("Missing BSC_RPC_URL in .env");

const provider = new ethers.JsonRpcProvider(RPC);

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
];

const BC400 = (process.env.BC400_TOKEN_ADDRESS || "").toLowerCase();
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

(async () => {
  const code = await provider.getCode(pair);
  console.log("pair:", pair);
  console.log("hasCode:", code && code !== "0x");

  if (!code || code === "0x") process.exit(0);

  const c = new ethers.Contract(pair, PAIR_ABI, provider);

  try {
    const t0 = (await c.token0()).toLowerCase();
    const t1 = (await c.token1()).toLowerCase();
    console.log("token0:", t0);
    console.log("token1:", t1);

    console.log("matches BC400:", t0 === BC400 || t1 === BC400);
    console.log("has WBNB:", t0 === WBNB || t1 === WBNB);

    const r = await c.getReserves();
    console.log("reserves:", r[0].toString(), r[1].toString());
  } catch (e) {
    console.log("Not a V2 pair (token0/token1 failed):", String(e?.message || e));
  }
})();