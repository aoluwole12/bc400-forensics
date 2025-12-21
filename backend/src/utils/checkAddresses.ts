import "dotenv/config";
import { getAddress } from "ethers";

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
}

function check(label: string, raw: string | undefined) {
  const v = String(raw || "").trim();

  if (!isHexAddress(v)) {
    return { label, ok: false, raw: v, error: "Invalid hex address (must be 0x + 40 hex chars)" };
  }

  try {
    return { label, ok: true, raw: v, checksum: getAddress(v) };
  } catch (e: any) {
    return { label, ok: false, raw: v, error: String(e?.message || e) };
  }
}

const results = [
  check("BC400_TOKEN_ADDRESS", process.env.BC400_TOKEN_ADDRESS),
  check("BC400_PAIR_ADDRESS", process.env.BC400_PAIR_ADDRESS),
  check("RAW_WBNB", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
  check("RAW_FACTORY", "0xca143ce32fe78f1f7019d7d551a6402fc5350c73"),
];

console.log(JSON.stringify(results, null, 2));

const bad = results.some(r => !r.ok);
process.exit(bad ? 1 : 0);