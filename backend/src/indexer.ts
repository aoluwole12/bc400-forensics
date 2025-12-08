import "dotenv/config";
import { ethers, Log } from "ethers";
import { pool, getOrCreateAddress } from "./db";

// ---------- ENV + PROVIDER SETUP ----------

const rpcUrl = process.env.BSC_RPC_URL!;
const tokenAddress = process.env.BC400_TOKEN_ADDRESS!;
const startBlockEnv = process.env.BC400_START_BLOCK;

if (!rpcUrl || !tokenAddress) {
  console.error("Missing BSC_RPC_URL or BC400_TOKEN_ADDRESS in .env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpcUrl);

const transferTopic = ethers.id("Transfer(address,address,uint256)");
const iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// ---------- HELPERS (shared style with backfill) ----------

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global RPC wrapper: throttle + retry on rate limits / glitches
async function callRpc<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      const result = await fn();
      // Small delay between all RPC calls to be polite
      await sleep(500);
      return result;
    } catch (err: any) {
      const msg =
        typeof err?.message === "string"
          ? err.message
          : JSON.stringify(err ?? {});

      console.error("RPC error:", msg);

      // Generic rate-limit / transient error handling
      if (
        msg.includes("rate limit") ||
        msg.includes("Too many requests") ||
        msg.includes("429") ||
        msg.includes("timeout") ||
        msg.includes("temporarily unavailable")
      ) {
        console.log("Hit RPC limit / temporary issue — waiting 5s then retry…");
        await sleep(5000);
        continue;
      }

      throw err;
    }
  }
}

// getLogs over a range, using the global throttle
async function getLogsRange(from: bigint, to: bigint): Promise<Log[]> {
  return callRpc(() =>
    provider.getLogs({
      address: tokenAddress,
      fromBlock: Number(from),
      toBlock: Number(to),
      topics: [transferTopic],
    })
  );
}

// Cache block timestamps so we only call getBlock ONCE per block
const blockTimestampCache = new Map<number, Date>();

async function getBlockTimestamp(blockNumber: number): Promise<Date> {
  if (blockTimestampCache.has(blockNumber)) {
    return blockTimestampCache.get(blockNumber)!;
  }

  const block = await callRpc(() => provider.getBlock(blockNumber));
  const ts = new Date(Number(block!.timestamp) * 1000);
  blockTimestampCache.set(blockNumber, ts);
  return ts;
}

// ---------- SAVE ONE TRANSFER (same schema as backfill) ----------

async function saveTransfer(log: Log) {
  const parsed = iface.parseLog(log);
  const from = parsed.args[0] as string;
  const to = parsed.args[1] as string;
  const value = parsed.args[2] as bigint;

  const blockTime = await getBlockTimestamp(log.blockNumber);
  const blockNumBig = BigInt(log.blockNumber);

  const fromId = await getOrCreateAddress(from, blockNumBig);
  const toId = await getOrCreateAddress(to, blockNumBig);

  const rawAmount = value.toString(); // store raw 18-decimals value

  await pool.query(
    `INSERT INTO transfers (
      tx_hash,
      log_index,
      block_number,
      block_time,
      from_address_id,
      to_address_id,
      raw_amount
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT DO NOTHING`,
    [
      log.transactionHash,
      log.index,
      log.blockNumber,
      blockTime.toISOString(),
      fromId,
      toId,
      rawAmount,
    ]
  );
}

// ---------- READ LAST INDEXED BLOCK FROM DB ----------

async function getLastIndexedBlock(): Promise<bigint | null> {
  const res = await pool.query("SELECT MAX(block_number) AS max FROM transfers");
  const max = res.rows[0]?.max as string | null;
  if (!max) return null;
  return BigInt(max);
}

// ---------- MAIN LIVE INDEXER LOOP (polling on NodeReal) ----------

async function runIndexer() {
  console.log("BC400 live indexer (NodeReal) starting…");

  const latestOnChain = BigInt(await callRpc(() => provider.getBlockNumber()));

  let from: bigint;

  const lastIndexed = await getLastIndexedBlock();
  if (lastIndexed !== null) {
    from = lastIndexed + 1n;
    console.log(
      `Resuming from DB after block ${lastIndexed} (starting at ${from})`
    );
  } else if (startBlockEnv) {
    from = BigInt(startBlockEnv);
    console.log(
      `No previous data. Starting from BC400_START_BLOCK=${from} (env).`
    );
  } else {
    // Safety fallback: start a bit behind latest
    from = latestOnChain > 10_000n ? latestOnChain - 10_000n : 0n;
    console.log(
      `No previous data and no BC400_START_BLOCK. Starting from ${from}.`
    );
  }

  // NodeReal can handle larger ranges than your old QuickNode free plan.
  // 499n => inclusive range of 500 blocks per getLogs call.
  const batchSize = 499n;

  while (true) {
    const latest = BigInt(await callRpc(() => provider.getBlockNumber()));

    if (from > latest) {
      console.log(`Up to date at block ${latest}. Sleeping 15s…`);
      await sleep(15000);
      continue;
    }

    let to = from + batchSize;
    if (to > latest) to = latest;

    console.log(`Scanning blocks ${from} → ${to} (latest ${latest}) …`);

    let logs: Log[] = [];
    try {
      logs = await getLogsRange(from, to);
    } catch (err) {
      console.error("Failed to get logs for range", err);
      // Skip this range so the loop continues
      from = to + 1n;
      continue;
    }

    console.log(`  Found ${logs.length} Transfer logs`);

    for (const log of logs) {
      try {
        await saveTransfer(log);
      } catch (err) {
        console.error("Error saving transfer", err);
      }
    }

    from = to + 1n;
  }
}

runIndexer().catch((err) => {
  console.error("Indexer crashed:", err);
  process.exit(1);
});