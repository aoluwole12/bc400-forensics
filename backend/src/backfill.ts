import "dotenv/config";
import { ethers, Log } from "ethers";
import { pool, getOrCreateAddressId, getMeta, setMeta } from "./db";
import { provider, callRpc } from "./clients/bscClient";

// ---------- Config ----------
const tokenAddress = process.env.BC400_TOKEN_ADDRESS!;
const decimals = Number(process.env.BC400_DECIMALS || 18);
const startBlockEnv = process.env.BC400_START_BLOCK;

if (!tokenAddress) throw new Error("Missing BC400_TOKEN_ADDRESS in .env");
if (!startBlockEnv) throw new Error("Missing BC400_START_BLOCK in .env");

const CONFIGURED_START_BLOCK = BigInt(startBlockEnv);

// How many blocks per getLogs batch (Growth can handle bigger; still keep sane)
const CHUNK_SIZE = BigInt(process.env.BACKFILL_CHUNK_SIZE || "4000");

// ERC-20 Transfer topic
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function parseTransferLog(log: Log) {
  const from = "0x" + log.topics[1].slice(26);
  const to = "0x" + log.topics[2].slice(26);
  const rawAmount = BigInt(log.data);
  const _humanAmount = Number(rawAmount) / 10 ** decimals;
  return { from, to, rawAmount };
}

// Fetch logs with retry/backoff (centralized in callRpc)
async function getLogsRange(from: bigint, to: bigint): Promise<Log[]> {
  return callRpc(
    async () =>
      (await provider.getLogs({
        address: tokenAddress,
        topics: [TRANSFER_TOPIC],
        fromBlock: Number(from),
        toBlock: Number(to),
      })) as Log[],
    `getLogs(${from}-${to})`
  );
}

// Cache block timestamps so we call getBlock once per unique block
const blockTimeCache = new Map<number, Date>();

async function getBlockTime(blockNumber: number): Promise<Date> {
  const cached = blockTimeCache.get(blockNumber);
  if (cached) return cached;

  const b = await callRpc(() => provider.getBlock(blockNumber), `getBlock(${blockNumber})`);
  const t = new Date(Number(b!.timestamp) * 1000);
  blockTimeCache.set(blockNumber, t);
  return t;
}

async function main() {
  console.log("🚀 Starting BC400 backfill (optimized)...");
  console.log(`Token: ${tokenAddress}`);
  console.log(`Configured start block: ${CONFIGURED_START_BLOCK}`);

  const latestBlock = BigInt(await callRpc(() => provider.getBlockNumber(), "getBlockNumber"));
  console.log(`Latest block on chain: ${latestBlock}`);

  // resume from meta if present
  const lastScannedStr = await getMeta("last_scanned_block");
  const lastScanned = lastScannedStr ? BigInt(lastScannedStr) : null;

  const effectiveStart = lastScanned !== null ? lastScanned + 1n : CONFIGURED_START_BLOCK;

  if (effectiveStart > latestBlock) {
    console.log(`Nothing to backfill. effectiveStart=${effectiveStart} > latest=${latestBlock}`);
    process.exit(0);
  }

  console.log(`Effective start block: ${effectiveStart}`);

  for (let from = effectiveStart; from <= latestBlock; from += CHUNK_SIZE + 1n) {
    const to = from + CHUNK_SIZE > latestBlock ? latestBlock : from + CHUNK_SIZE;
    console.log(`\n🔎 Scanning blocks ${from} → ${to}…`);

    // 1) get logs
    let logs: Log[] = [];
    try {
      logs = await getLogsRange(from, to);
    } catch (e) {
      console.error(`❌ Failed getLogs for ${from}-${to}`, e);
      // do not advance meta; retry next run
      throw e;
    }
    console.log(`  Found ${logs.length} Transfer logs`);

    if (logs.length === 0) {
      await setMeta("last_scanned_block", to.toString());
      console.log(`  ✅ Updated last_scanned_block = ${to}`);
      continue;
    }

    // 2) group unique blocks, prefetch timestamps once per block
    const uniqueBlocks = Array.from(new Set(logs.map((l) => l.blockNumber))).sort((a, b) => a - b);
    for (const bn of uniqueBlocks) {
      await getBlockTime(bn);
    }

    // 3) single DB client for whole chunk
    const client = await pool.connect();
    try {
      // Build arrays for batch insert
      const tx_hash: string[] = [];
      const log_index: number[] = [];
      const block_number: string[] = [];
      const block_time: Date[] = [];
      const from_id: number[] = [];
      const to_id: number[] = [];
      const raw_amount: string[] = [];

      for (const log of logs) {
        const { from: fa, to: ta, rawAmount } = parseTransferLog(log);
        const bt = blockTimeCache.get(log.blockNumber)!;

        const faId = await getOrCreateAddressId(fa, client);
        const taId = await getOrCreateAddressId(ta, client);

        tx_hash.push(log.transactionHash);
        log_index.push(Number(log.index));
        block_number.push(String(log.blockNumber));
        block_time.push(bt);
        from_id.push(faId);
        to_id.push(taId);
        raw_amount.push(rawAmount.toString());
      }

      // Insert in chunks to avoid huge parameter payloads
      const BATCH_ROWS = 500;
      for (let i = 0; i < tx_hash.length; i += BATCH_ROWS) {
        const j = Math.min(i + BATCH_ROWS, tx_hash.length);

        await client.query(
          `
          INSERT INTO transfers (
            tx_hash, log_index, block_number, block_time,
            from_address_id, to_address_id, raw_amount
          )
          SELECT *
          FROM UNNEST(
            $1::text[],
            $2::int[],
            $3::bigint[],
            $4::timestamptz[],
            $5::int[],
            $6::int[],
            $7::text[]
          )
          ON CONFLICT (tx_hash, log_index) DO NOTHING
          `,
          [
            tx_hash.slice(i, j),
            log_index.slice(i, j),
            block_number.slice(i, j).map((x) => BigInt(x).toString()),
            block_time.slice(i, j),
            from_id.slice(i, j),
            to_id.slice(i, j),
            raw_amount.slice(i, j),
          ]
        );
      }
    } finally {
      client.release();
    }

    // 4) advance meta
    await setMeta("last_scanned_block", to.toString());
    console.log(`  ✅ Updated last_scanned_block = ${to}`);
  }

  console.log("\n✅ Backfill complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});
