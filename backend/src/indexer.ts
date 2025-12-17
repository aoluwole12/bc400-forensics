import "dotenv/config";
import { ethers } from "ethers";
import { pool, getMeta, setMeta } from "./db";
import { callRpc, provider } from "./clients/bscClient";
import type { PoolClient } from "pg";
import { tryAdvisoryLock, advisoryUnlock } from "./dbLocks";

// ------------------- Env (supports Render + local) -------------------
const tokenAddress = (process.env.BC400_TOKEN_ADDRESS || process.env.TOKEN_ADDRESS || "").toLowerCase();
const startBlockEnv = process.env.BC400_START_BLOCK || process.env.START_BLOCK;

if (!tokenAddress) throw new Error("Missing token address env. Set BC400_TOKEN_ADDRESS or TOKEN_ADDRESS");
if (!startBlockEnv) throw new Error("Missing start block env. Set BC400_START_BLOCK or START_BLOCK");

const START_BLOCK = BigInt(startBlockEnv);

// ------------------- Lock (shared with backfill) -------------------
const LOCK_NAME = process.env.BC400_JOB_LOCK || "bc400_writer_lock";
const LOCK_RETRY_MS = Number(process.env.BC400_LOCK_RETRY_MS || 15_000);

// ------------------- Tuning -------------------
const INDEXER_BATCH_SIZE = BigInt(process.env.INDEXER_BATCH_SIZE || "2000");
const CONFIRMATIONS = BigInt(process.env.INDEXER_CONFIRMATIONS || "5");
const LOOKBACK_BLOCKS = BigInt(process.env.INDEXER_LOOKBACK_BLOCKS || "25");
const SLEEP_MS = Number(process.env.INDEXER_SLEEP_MS || "12000");
const MAX_BLOCKTIME_CACHE = Number(process.env.INDEXER_BLOCKTIME_CACHE || "10000");

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTransferLog(log: any) {
  const from = ("0x" + log.topics[1].slice(26)).toLowerCase();
  const to = ("0x" + log.topics[2].slice(26)).toLowerCase();
  const rawAmount = BigInt(log.data);
  return { from, to, rawAmount };
}

async function getLogsRange(from: bigint, to: bigint) {
  return callRpc(
    async () =>
      provider.getLogs({
        address: tokenAddress,
        topics: [TRANSFER_TOPIC],
        fromBlock: Number(from),
        toBlock: Number(to),
      }),
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

async function resolveNextFrom(): Promise<bigint> {
  const meta = await getMeta("last_indexed_block");
  if (meta) return BigInt(meta) + 1n;

  const res = await pool.query("SELECT MAX(block_number) AS max FROM transfers");
  const max = res.rows[0]?.max;
  if (max) return BigInt(max) + 1n;

  return START_BLOCK;
}

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

export async function runIndexer() {
  console.log("🟡 BC400 live indexer (safeLatest + idempotent + overlap + advisory lock)");
  console.log("Token:", tokenAddress);
  console.log("START_BLOCK:", START_BLOCK.toString());
  console.log("LOCK_NAME:", LOCK_NAME);

  // Acquire lock (light retry loop)
  const lockClient = await pool.connect();
  try {
    while (true) {
      const ok = await tryAdvisoryLock(lockClient, LOCK_NAME);
      if (ok) break;

      console.log(`🔒 Lock busy (${LOCK_NAME}). Backfill running. Sleeping ${LOCK_RETRY_MS}ms...`);
      await sleep(LOCK_RETRY_MS);
    }

    let nextFrom = await resolveNextFrom();
    if (nextFrom < START_BLOCK) nextFrom = START_BLOCK;
    console.log("Initial nextFrom:", nextFrom.toString());

    while (true) {
      const latest = BigInt(await callRpc(() => provider.getBlockNumber(), "getBlockNumber"));
      const safeLatest = latest > CONFIRMATIONS ? latest - CONFIRMATIONS : 0n;

      if (nextFrom > safeLatest) {
        console.log(`Up to date. latest=${latest} safeLatest=${safeLatest}. Sleeping ${SLEEP_MS}ms...`);
        await sleep(SLEEP_MS);
        continue;
      }

      const scanFrom = nextFrom > LOOKBACK_BLOCKS ? nextFrom - LOOKBACK_BLOCKS : START_BLOCK;
      let scanTo = nextFrom + (INDEXER_BATCH_SIZE - 1n);
      if (scanTo > safeLatest) scanTo = safeLatest;

      console.log(`Scanning ${scanFrom} → ${scanTo} (nextFrom=${nextFrom}, safeLatest=${safeLatest})`);

      let logs: any[] = [];
      try {
        logs = await getLogsRange(scanFrom, scanTo);
      } catch (err) {
        console.error("getLogs failed (retry after 5s):", err);
        await sleep(5000);
        continue;
      }

      console.log(`  Found ${logs.length} Transfer logs`);

      if (logs.length > 0) {
        const uniqueBlocks = Array.from(new Set(logs.map((l) => Number(l.blockNumber)))).sort((a, b) => a - b);
        for (const bn of uniqueBlocks) await getBlockTime(bn);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (logs.length > 0) {
          const addrList: string[] = [];
          for (const log of logs) {
            const { from: fa, to: ta } = parseTransferLog(log);
            addrList.push(fa, ta);
          }
          const addrMap = await bulkGetOrCreateAddressIds(client, addrList);

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

            const li = Number((log as any).logIndex ?? (log as any).index ?? 0);

            tx_hash.push(String(log.transactionHash));
            log_index.push(li);
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

        await setMeta("last_indexed_block", scanTo.toString(), client);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("Indexer chunk failed (rolled back):", e);
        await sleep(5000);
        continue;
      } finally {
        client.release();
      }

      nextFrom = scanTo + 1n;
    }
  } finally {
    try {
      await advisoryUnlock(lockClient, LOCK_NAME);
    } catch {}
    lockClient.release();
  }
}

runIndexer().catch((err) => {
  console.error("Indexer crashed:", err);
  process.exit(1);
});