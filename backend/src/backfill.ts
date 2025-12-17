import "dotenv/config";
import { ethers, Log } from "ethers";
import { pool, getMeta, setMeta } from "./db";
import { provider, callRpc } from "./clients/bscClient";
import type { PoolClient } from "pg";

// ------------------- Env (supports Render + local) -------------------
const tokenAddress = (process.env.BC400_TOKEN_ADDRESS || process.env.TOKEN_ADDRESS || "").toLowerCase();
const startBlockEnv = process.env.BC400_START_BLOCK || process.env.START_BLOCK;

if (!tokenAddress) throw new Error("Missing token address env. Set BC400_TOKEN_ADDRESS or TOKEN_ADDRESS");
if (!startBlockEnv) throw new Error("Missing start block env. Set BC400_START_BLOCK or START_BLOCK");

const CONFIGURED_START_BLOCK = BigInt(startBlockEnv);

// ------------------- Tuning -------------------
const CHUNK_SIZE = BigInt(process.env.BACKFILL_CHUNK_SIZE || "4000"); // logs range window
const CONFIRMATIONS = BigInt(process.env.BACKFILL_CONFIRMATIONS || process.env.INDEXER_CONFIRMATIONS || "5");
const LOOKBACK_BLOCKS = BigInt(process.env.BACKFILL_LOOKBACK_BLOCKS || "0"); // optional overlap for reorg safety
const MAX_BLOCKTIME_CACHE = Number(process.env.BACKFILL_BLOCKTIME_CACHE || "20000");
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTransferLog(log: Log) {
  const from = ("0x" + log.topics[1].slice(26)).toLowerCase();
  const to = ("0x" + log.topics[2].slice(26)).toLowerCase();
  const rawAmount = BigInt(log.data);
  return { from, to, rawAmount };
}

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

// -------- bounded block time cache --------
const blockTimeCache = new Map<number, Date>();

async function getBlockTime(blockNumber: number): Promise<Date> {
  const cached = blockTimeCache.get(blockNumber);
  if (cached) return cached;

  const b = await callRpc(() => provider.getBlock(blockNumber), `getBlock(${blockNumber})`);
  if (!b) throw new Error(`getBlock(${blockNumber}) returned null`);

  const t = new Date(Number(b.timestamp) * 1000);
  blockTimeCache.set(blockNumber, t);

  if (blockTimeCache.size > MAX_BLOCKTIME_CACHE) {
    blockTimeCache.clear();
    blockTimeCache.set(blockNumber, t);
  }

  return t;
}

// -------- bulk address upsert + id fetch (same as indexer style) --------
async function bulkGetOrCreateAddressIds(client: PoolClient, addrs: string[]): Promise<Map<string, number>> {
  if (addrs.length === 0) return new Map();

  const unique = Array.from(new Set(addrs.map((a) => a.toLowerCase())));

  await client.query(
    `
    INSERT INTO addresses (address)
    SELECT * FROM UNNEST($1::text[])
    ON CONFLICT (address) DO NOTHING
    `,
    [unique]
  );

  const res = await client.query(
    `
    SELECT id, address
    FROM addresses
    WHERE address = ANY($1::text[])
    `,
    [unique]
  );

  const map = new Map<string, number>();
  for (const r of res.rows) map.set(String(r.address), Number(r.id));
  return map;
}

// ------------------- Progress logic -------------------
async function resolveStartFrom(): Promise<bigint> {
  // backfill meta (preferred)
  const backfilled = await getMeta("last_backfilled_block");
  if (backfilled) return BigInt(backfilled) + 1n;

  // older key (if you used it before)
  const scanned = await getMeta("last_scanned_block");
  if (scanned) return BigInt(scanned) + 1n;

  return CONFIGURED_START_BLOCK;
}

async function resolveBackfillTarget(): Promise<bigint> {
  // safeLatest protects against reorgs
  const latest = BigInt(await callRpc(() => provider.getBlockNumber(), "getBlockNumber"));
  const safeLatest = latest > CONFIRMATIONS ? latest - CONFIRMATIONS : 0n;

  // IMPORTANT: never backfill past the indexer’s claimed progress
  const indexed = await getMeta("last_indexed_block");
  const indexerTip = indexed ? BigInt(indexed) : 0n;

  // target = min(safeLatest, indexerTip)
  let target = safeLatest < indexerTip ? safeLatest : indexerTip;

  // if indexerTip is 0 (not set yet), fall back to safeLatest (optional)
  if (!indexed) target = safeLatest;

  return target;
}

// ------------------- Backfill -------------------
async function runBackfillOnce() {
  console.log("🟡 BC400 backfill (indexer-compatible, bulk address upserts, monotonic meta)");
  console.log("Token:", tokenAddress);
  console.log("Configured START_BLOCK:", CONFIGURED_START_BLOCK.toString());
  console.log("CHUNK_SIZE:", CHUNK_SIZE.toString(), "CONFIRMATIONS:", CONFIRMATIONS.toString());

  let from = await resolveStartFrom();
  if (from < CONFIGURED_START_BLOCK) from = CONFIGURED_START_BLOCK;

  const target = await resolveBackfillTarget();

  console.log("Initial from:", from.toString());
  console.log("Target (safe + indexerTip):", target.toString());

  if (from > target) {
    console.log(`✅ Nothing to backfill. from=${from} > target=${target}`);
    return;
  }

  for (let chunkFrom = from; chunkFrom <= target; chunkFrom += CHUNK_SIZE + 1n) {
    let chunkTo = chunkFrom + CHUNK_SIZE;
    if (chunkTo > target) chunkTo = target;

    // Optional overlap (rarely needed). Keep 0 by default to save RPC.
    const scanFrom = LOOKBACK_BLOCKS > 0n && chunkFrom > LOOKBACK_BLOCKS
      ? chunkFrom - LOOKBACK_BLOCKS
      : chunkFrom;

    console.log(`\n🔎 Backfilling ${scanFrom} → ${chunkTo} (progressFrom=${chunkFrom})`);

    let logs: Log[] = [];
    try {
      logs = await getLogsRange(scanFrom, chunkTo);
    } catch (e) {
      console.error(`❌ getLogs failed for ${scanFrom}-${chunkTo}`, e);
      throw e; // do not advance meta
    }

    console.log(`  Found ${logs.length} Transfer logs`);

    // Prefetch block times only if logs exist
    if (logs.length > 0) {
      const uniqueBlocks = Array.from(new Set(logs.map((l) => Number(l.blockNumber)))).sort((a, b) => a - b);
      for (const bn of uniqueBlocks) await getBlockTime(bn);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (logs.length > 0) {
        // bulk resolve addresses once
        const addrList: string[] = [];
        for (const log of logs) {
          const { from: fa, to: ta } = parseTransferLog(log);
          addrList.push(fa, ta);
        }
        const addrMap = await bulkGetOrCreateAddressIds(client, addrList);

        // build insert arrays
        const tx_hash: string[] = [];
        const log_index: number[] = [];
        const block_number: string[] = [];
        const block_time: Date[] = [];
        const from_id: number[] = [];
        const to_id: number[] = [];
        const raw_amount: string[] = [];

        for (const log of logs) {
          const { from: fa, to: ta, rawAmount } = parseTransferLog(log);
          const bn = Number(log.blockNumber);
          const bt = blockTimeCache.get(bn) || (await getBlockTime(bn));

          const faId = addrMap.get(fa);
          const taId = addrMap.get(ta);
          if (!faId || !taId) throw new Error(`Address id missing fa=${fa} ta=${ta}`);

          tx_hash.push(String(log.transactionHash));
          log_index.push(Number((log as any).index));
          block_number.push(String(log.blockNumber));
          block_time.push(bt);
          from_id.push(faId);
          to_id.push(taId);
          raw_amount.push(rawAmount.toString());
        }

        // insert in batches
        const BATCH_ROWS = 1000;
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
      }

      // ✅ Monotonic progress based on chunkTo (not scanFrom)
      await setMeta("last_backfilled_block", chunkTo.toString(), client);

      // Optional: keep legacy key updated too (harmless)
      await setMeta("last_scanned_block", chunkTo.toString(), client);

      await client.query("COMMIT");
      console.log(`  ✅ last_backfilled_block = ${chunkTo}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("❌ Backfill chunk failed (rolled back):", e);
      // small pause to avoid hot-looping on failures
      await sleep(3000);
      throw e;
    } finally {
      client.release();
    }
  }

  console.log("\n✅ Backfill complete.");
}

runBackfillOnce().catch((err) => {
  console.error("❌ Backfill crashed:", err);
  process.exit(1);
});