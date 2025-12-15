import "dotenv/config";
import { ethers, Log } from "ethers";
import { pool, getOrCreateAddressId, getMeta, setMeta } from "./db";
import { provider, callRpc } from "./clients/bscClient";

const tokenAddress = process.env.BC400_TOKEN_ADDRESS!;
const startBlockEnv = process.env.BC400_START_BLOCK;

if (!tokenAddress) throw new Error("Missing BC400_TOKEN_ADDRESS in .env");
if (!startBlockEnv) throw new Error("Missing BC400_START_BLOCK in .env");

const START_BLOCK = BigInt(startBlockEnv);

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTransferLog(log: Log) {
  const from = "0x" + log.topics[1].slice(26);
  const to = "0x" + log.topics[2].slice(26);
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

const blockTimeCache = new Map<number, Date>();

async function getBlockTime(blockNumber: number): Promise<Date> {
  const cached = blockTimeCache.get(blockNumber);
  if (cached) return cached;

  const b = await callRpc(() => provider.getBlock(blockNumber), `getBlock(${blockNumber})`);
  const t = new Date(Number(b!.timestamp) * 1000);
  blockTimeCache.set(blockNumber, t);
  return t;
}

// Determine start position:
// 1) meta last_indexed_block
// 2) else MAX(block_number) once
// 3) else START_BLOCK
async function resolveStartFromDb(): Promise<bigint> {
  const meta = await getMeta("last_indexed_block");
  if (meta) return BigInt(meta) + 1n;

  const res = await pool.query("SELECT MAX(block_number) AS max FROM transfers");
  const max = res.rows[0]?.max as string | null;
  if (max) return BigInt(max) + 1n;

  return START_BLOCK;
}

export async function runIndexer() {
  console.log("🟡 BC400 live indexer starting (optimized)...");
  console.log("Token:", tokenAddress);

  let from = await resolveStartFromDb();
  console.log("Starting at block:", from.toString());

  // Growth can handle more; keep a reasonable batch
  let batchSize = BigInt(process.env.INDEXER_BATCH_SIZE || "2000");

  while (true) {
    const latest = BigInt(await callRpc(() => provider.getBlockNumber(), "getBlockNumber"));

    if (from > latest) {
      console.log(`Up to date at block ${latest}. Sleeping 12s…`);
      await sleep(12000);
      continue;
    }

    let to = from + (batchSize - 1n);
    if (to > latest) to = latest;

    console.log(`Scanning blocks ${from} → ${to} (latest ${latest})`);

    let logs: Log[] = [];
    try {
      logs = await getLogsRange(from, to);
    } catch (err) {
      console.error("getLogs failed; shrinking batch and retrying…", err);
      // shrink batch to reduce payload/rate pressure, then retry
      batchSize = batchSize > 200n ? batchSize / 2n : 200n;
      await sleep(5000);
      continue;
    }

    console.log(`  Found ${logs.length} Transfer logs`);

    if (logs.length > 0) {
      const uniqueBlocks = Array.from(new Set(logs.map((l) => l.blockNumber))).sort((a, b) => a - b);
      for (const bn of uniqueBlocks) {
        await getBlockTime(bn);
      }

      const client = await pool.connect();
      try {
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
    }

    // advance meta and move forward
    await setMeta("last_indexed_block", to.toString());
    from = to + 1n;

    // If we shrank earlier and things are stable, gently grow back up
    const target = BigInt(process.env.INDEXER_BATCH_SIZE || "2000");
    if (batchSize < target) batchSize = BigInt(Math.min(Number(target), Number(batchSize) * 2));
  }
}

// run as script
runIndexer().catch((err) => {
  console.error("Indexer crashed:", err);
  process.exit(1);
});
