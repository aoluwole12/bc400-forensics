import "dotenv/config";
import { ethers } from "ethers";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

function mustAddr(label: string, v?: string) {
  const val = (v ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(val)) throw new Error(`Missing/invalid ${label}: "${val}"`);
  return val;
}

async function main() {
  const rpcUrl = (process.env.BSC_RPC_URL || "").trim();
  if (!rpcUrl) throw new Error("Missing BSC_RPC_URL");

  const tokenAddress = mustAddr("BC400_TOKEN_ADDRESS", process.env.BC400_TOKEN_ADDRESS);
  const pairAddress = mustAddr("BC400_PAIR_ADDRESS", process.env.BC400_PAIR_ADDRESS);

  const devburn = (process.env.BC400_DEV_BURN_WALLET || "").trim();
  const locked = (process.env.BC400_LOCKED_ADDRESS || "").trim();

  const burnDead = "0x000000000000000000000000000000000000dEaD";
  const zeroAddr = "0x0000000000000000000000000000000000000000";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  const decimals: number = Number(await token.decimals());
  const totalSupply: bigint = BigInt((await token.totalSupply()).toString());

  const burnDeadBal: bigint = BigInt((await token.balanceOf(burnDead)).toString());
  const zeroBal: bigint = BigInt((await token.balanceOf(zeroAddr)).toString());
  const lpBal: bigint = BigInt((await token.balanceOf(pairAddress)).toString());

  const devburnBal: bigint = /^0x[a-fA-F0-9]{40}$/.test(devburn)
    ? BigInt((await token.balanceOf(devburn)).toString())
    : 0n;

  const lockedBal: bigint = /^0x[a-fA-F0-9]{40}$/.test(locked)
    ? BigInt((await token.balanceOf(locked)).toString())
    : 0n;

  const circulatingIfDeadOnly = totalSupply - burnDeadBal - lpBal - lockedBal;
  const circulatingWithZero = totalSupply - (burnDeadBal + zeroBal + devburnBal) - lpBal - lockedBal;

  console.log("token:", tokenAddress);
  console.log("decimals:", decimals);
  console.log("totalSupplyRaw:", totalSupply.toString());
  console.log("burnDeadRaw:", burnDeadBal.toString());
  console.log("zeroAddrRaw:", zeroBal.toString());
  console.log("devburnRaw:", devburnBal.toString());
  console.log("lpRaw:", lpBal.toString());
  console.log("lockedRaw:", lockedBal.toString());
  console.log("circulating (dead only):", circulatingIfDeadOnly.toString());
  console.log("circulating (+zero+devburn):", circulatingWithZero.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
