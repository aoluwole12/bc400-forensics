import "dotenv/config";
import { ethers } from "ethers";

const rpcUrl = process.env.BSC_RPC_URL;
if (!rpcUrl) throw new Error("Missing BSC_RPC_URL in .env");

export const provider = new ethers.JsonRpcProvider(rpcUrl);

// ---------- polite global throttle ----------
let lastRpcAt = 0;
const MIN_RPC_GAP_MS = Number(process.env.RPC_MIN_GAP_MS || 120); // Growth can handle this; free plan would be higher.

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, MIN_RPC_GAP_MS - (now - lastRpcAt));
  if (wait > 0) await sleep(wait);
  lastRpcAt = Date.now();
}

function looksRateLimited(msg: string) {
  return (
    msg.includes("429") ||
    msg.toLowerCase().includes("too many requests") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("exceeded maximum retry") ||
    msg.toLowerCase().includes("temporarily") ||
    msg.toLowerCase().includes("timeout") ||
    msg.toLowerCase().includes("server error")
  );
}

/**
 * callRpc
 * - global throttle
 * - exponential backoff on 429/temporary errors
 */
export async function callRpc<T>(fn: () => Promise<T>, label = "rpc"): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      await throttle();
      return await fn();
    } catch (err: any) {
      const msg =
        typeof err?.message === "string"
          ? err.message
          : JSON.stringify(err ?? {});
      attempt += 1;

      if (looksRateLimited(msg)) {
        const backoff = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt, 5)));
        console.error(`[${label}] rate/temporary error -> retry in ${backoff}ms`, msg);
        await sleep(backoff);
        continue;
      }

      console.error(`[${label}] fatal error`, msg);
      throw err;
    }
  }
}
