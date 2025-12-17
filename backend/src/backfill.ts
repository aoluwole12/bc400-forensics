import "dotenv/config";
import { ethers, type Log } from "ethers";
import { pool, getMeta, setMeta } from "./db";
import { provider, callRpc } from "./clients/bscClient";
import type { PoolClient } from "pg";

// ------------------- Env (supports Render + local) -------------------
const tokenAddress = (process.env.BC400_TOKEN_ADDRESS || process.env.TOKEN_ADDRESS || "").toLowerCase();
const startBlockEnv = process.env.BC400_START_BLOCK || process.env.START_BLOCK;

if (!tokenAddress) throw new Error("Missing token address env. Set BC400_TOKEN_ADDRESS or TOKEN_ADDRESS");
if (!startBlockEnv) throw new Error("Missing start block env. Set BC400_START_BLOCK or START_BLOCK");

const START_BLOCK = BigInt(startBlockEnv);

// ------------------- Tuning -------------------
const CHUNK_SIZE = BigInt(process.env.BACKFILL_CHUNK_SIZE || "4000");
const CONFIRMATIONS = BigInt(process.env.BACKFILL_CONFIRMATIONS || "5"); // reorg safety for “near head”
const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS || "0"); // backfill usually runs once; 0 = no sleep
const MAX_BLOCKTIME_CACHE = Number(process.env.BACKFILL_BLOCKTIME_CACHE || "10000");

// Meta key dedicated to backfill (do NOT reuse last_scanned_block)
const BACKFILL_META_KEY = "last_backfilled_block";

// ERC-20 Transfer topic
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

// bounded cache
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

/**
 * Bulk resolve address -> id using 2 queries:
 * 1) INSERT missing (ON CONFLICT DO NOTHING)
 * 2) SELECT ids back
 */
async function bulkGetOrCreateAddressIds(
  client: PoolClient,
  addrs: string[]
): Promise<Map<string, number>> {
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

async function resolveNextFrom(): Promise<bigint> {
  const meta = await getMeta(BACKFILL_META_KEY);
  if (meta) return BigInt(meta) + 1n;
  return START_BLOCK;
}

async function resolveTargetTo(): Promise<bigint> {
  // Prefer stopping at indexer progress if present (keeps backfill from “chasing head” forever)
  const indexed = await getMeta("last_indexed_block");
  if (indexed) return BigInt(indexed);

  // otherwise use safeLatest
  const latest = BigInt(await callRpc(() => provider.getBlockNumber(), "getBlockNumber"));
  const safeLatest = latest > CONFIRMATIONS ? latest - CONFIRMATIONS : 0n;
  return safeLatest;
}

async function main() {
  console.log("🧱 BC400 backfill (indexer-compatible, bulk address upsert, transactional meta) شروع...");
  console.log("Token:", tokenAddress);
  console.log("START_BLOCK:", START_BLOCK.toString());

  let nextFrom = await resolveNextFrom();
  if (nextFrom < START_BLOCK) nextFrom = START_BLOCK;

  const targetTo = await resolveTargetTo();
  if (nextFrom > targetTo) {
    console.log(`Nothing to backfill. nextFrom=${nextFrom} > targetTo=${targetTo}`);
    process.exit(0);
  }

  console.log(`Backfill range: ${nextFrom} → ${targetTo}`);

  for (let from = nextFrom; from <= targetTo; ) {
    let to = from + (CHUNK_SIZE - 1n);
    if (to > targetTo) to = targetTo;

    console.log(`\n🔎 Scanning blocks ${from} → ${to}`);

    let logs: Log[] = [];
    try {
      logs = await getLogsRange(from, to);
    } catch (e) {
      console.error(`❌ getLogs failed for ${from}-${to} (will NOT advance meta)`, e);
      throw e;
    }

    console.log(`  Found ${logs.length} Transfer logs`);

    // Prefetch block times only if needed
    if (logs.length > 0) {
      const uniqueBlocks = Array.from(new Set(logs.map((l) => Number(l.blockNumber)))).sort((a, b) => a - b);
      for (const bn of uniqueBlocks) await getBlockTime(bn);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (logs.length > 0) {
        // bulk addresses
        const addrList: string[] = [];
        for (const log of logs) {
          const { from: fa, to: ta } = parseTransferLog(log);
          addrList.push(fa, ta);
        }
        const addrMap = await bulkGetOrCreateAddressIds(client, addrList);

        // build arrays
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
          log_index.push(Number(log.index));
          block_number.push(String(log.blockNumber));
          block_time.push(bt);
          from_id.push(faId);
          to_id.push(taId);
          raw_amount.push(rawAmount.toString());
        }

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

      // ✅ commit-safe progress
      await setMeta(BACKFILL_META_KEY, to.toString(), client);

      await client.query("COMMIT");
      console.log(`  ✅ Updated ${BACKFILL_META_KEY} = ${to}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("❌ Chunk failed (rolled back). Meta not advanced.", e);
      throw e;
    } finally {
      client.release();
    }

    from = to + 1n;
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  console.log("\n✅ Backfill complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});