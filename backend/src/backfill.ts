// src/backfill.ts
// BC400 historical backfill optimized for NodeReal Free

import "dotenv/config";
import { ethers, Log } from "ethers";
import { pool, getOrCreateAddress } from "./db";

// ---------- Config from .env ----------
const rpcUrl = process.env.BSC_RPC_URL!;
const tokenAddress = process.env.BC400_TOKEN_ADDRESS!;
const decimals = Number(process.env.BC400_DECIMALS || 18);
const startBlockEnv = process.env.BC400_START_BLOCK;

if (!rpcUrl || !tokenAddress) {
  throw new Error("Missing BSC_RPC_URL or BC400_TOKEN_ADDRESS in .env");
}

if (!startBlockEnv) {
  throw new Error("Missing BC400_START_BLOCK in .env");
}

const CONFIGURED_START_BLOCK = BigInt(startBlockEnv);

// How many blocks per batch
const CHUNK_SIZE = 4000n;

// ERC-20 Transfer topic
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

const provider = new ethers.JsonRpcProvider(rpcUrl);

// Simple sleep helper (for throttling)
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- meta table helpers (never re-scan same blocks) ----------
// meta table schema:
// CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

async function getLastScannedBlock(): Promise<bigint | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT value FROM meta WHERE key = 'last_scanned_block'"
    );
    if (res.rowCount === 0) return null;
    return BigInt(res.rows[0].value);
  } finally {
    client.release();
  }
}

async function setLastScannedBlock(block: bigint): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `
      INSERT INTO meta (key, value)
      VALUES ('last_scanned_block', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      [block.toString()]
    );
  } finally {
    client.release();
  }
}

// ---------- Log parsing + DB write ----------

function parseTransferLog(log: Log) {
  // topics[1] and topics[2] are 32-byte padded addresses
  const from = "0x" + log.topics[1].slice(26);
  const to = "0x" + log.topics[2].slice(26);
  const rawAmount = BigInt(log.data);

  // For display; we store rawAmount as string
  const humanAmount = Number(rawAmount) / 10 ** decimals;

  return { from, to, rawAmount, humanAmount };
}

async function saveTransfer(log: Log) {
  const { from, to, rawAmount } = parseTransferLog(log);

  const block = await provider.getBlock(log.blockNumber!);
  const blockTime = new Date(Number(block.timestamp) * 1000);

  const client = await pool.connect();
  try {
    // ✅ correct argument order: (address: string, client)
    const fromId = await getOrCreateAddress(from, client);
    const toId = await getOrCreateAddress(to, client);

    await client.query(
      `
      INSERT INTO transfers (
        tx_hash,
        log_index,
        block_number,
        block_time,
        from_address_id,
        to_address_id,
        raw_amount
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (tx_hash, log_index) DO NOTHING;
      `,
      [
        log.transactionHash,
        Number(log.index),           // ensure plain number
        Number(log.blockNumber),     // BIGINT in DB but small enough to cast
        blockTime,
        fromId,
        toId,
        rawAmount.toString(),
      ]
    );
  } finally {
    client.release();
  }
}

// ---------- Chunked, throttled getLogs (NodeReal-friendly) ----------

async function getLogsSafe(from: bigint, to: bigint): Promise<Log[]> {
  while (true) {
    try {
      const logs = (await provider.getLogs({
        address: tokenAddress,
        topics: [TRANSFER_TOPIC],
        fromBlock: Number(from),
        toBlock: Number(to),
      })) as Log[];

      // soft CU budget: ~3–4 calls/sec
      await sleep(300);
      return logs;
    } catch (err) {
      console.error(
        `getLogs error for blocks ${from}–${to}, retrying in 2s...`,
        err
      );
      await sleep(2000);
    }
  }
}

// ------------------------------- Main --------------------------------

async function main() {
  console.log("🚀 Starting BC400 backfill (NodeReal-optimized)...");
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Token:   ${tokenAddress}`);
  console.log(`Configured start block: ${CONFIGURED_START_BLOCK}`);

  const latestBlock = BigInt(await provider.getBlockNumber());
  console.log(`Latest block on chain: ${latestBlock}`);

  const lastScanned = await getLastScannedBlock();
  const effectiveStart =
    lastScanned !== null ? lastScanned + 1n : CONFIGURED_START_BLOCK;

  if (effectiveStart > latestBlock) {
    console.log(
      `Nothing to backfill. effectiveStart=${effectiveStart} > latest=${latestBlock}`
    );
    process.exit(0);
  }

  console.log(`Effective start block: ${effectiveStart}`);

  for (let from = effectiveStart; from <= latestBlock; from += CHUNK_SIZE + 1n) {
    const to =
      from + CHUNK_SIZE > latestBlock ? latestBlock : from + CHUNK_SIZE;

    console.log(`\n🔎 Scanning blocks ${from} → ${to}…`);

    const logs = await getLogsSafe(from, to);
    console.log(`  Found ${logs.length} Transfer logs`);

    for (const log of logs) {
      try {
        await saveTransfer(log);
      } catch (err) {
        console.error(
          `  ❌ Error saving log tx=${log.transactionHash} index=${log.index}`,
          err
        );
      }
    }

    await setLastScannedBlock(to);
    console.log(`  ✅ Updated last_scanned_block = ${to}`);
  }

  console.log("\n✅ Backfill complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});