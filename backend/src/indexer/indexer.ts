import "dotenv/config";
import { ethers } from "ethers";
import { pool, getOrCreateAddress } from "./db/index";

// ---- Config from .env ----
const rpcUrl = process.env.BSC_RPC_URL!;
const tokenAddress = process.env.BC400_TOKEN_ADDRESS!;
const decimals = Number(process.env.BC400_DECIMALS || 18);
const startBlock = BigInt(process.env.BC400_START_BLOCK || "0");

if (!rpcUrl || !tokenAddress) {
  console.error("Missing BSC_RPC_URL or BC400_TOKEN_ADDRESS in .env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpcUrl);

// topic for Transfer(address,address,uint256)
const transferTopic = ethers.id("Transfer(address,address,uint256)");
const iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

async function saveTransfer(log: ethers.Log) {
  const parsed = iface.parseLog(log);
  const from = parsed.args[0] as string;
  const to = parsed.args[1] as string;
  const value = parsed.args[2] as bigint;

  const block = await provider.getBlock(log.blockNumber);
  const timestamp = new Date(Number(block!.timestamp) * 1000);

  const fromId = await getOrCreateAddress(from, BigInt(log.blockNumber));
  const toId = await getOrCreateAddress(to, BigInt(log.blockNumber));

  const amountRaw = value.toString();
  const amount = Number(ethers.formatUnits(value, decimals));

  await pool.query(
    `INSERT INTO transfers (
      tx_hash,
      log_index,
      block_number,
      timestamp,
      from_address_id,
      to_address_id,
      amount_raw,
      amount
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT DO NOTHING`,
    [
      log.transactionHash,
      log.index,
      log.blockNumber,
      timestamp.toISOString(),
      fromId,
      toId,
      amountRaw,
      amount,
    ]
  );
}

async function runIndexer() {
  console.log("BC400 indexer starting...");

  const latestBlock = BigInt(await provider.getBlockNumber());
  console.log(`Latest block on BSC: ${latestBlock}`);

  const batchSize = 2000n;
  let from = startBlock;
  let to = from + batchSize;

  while (from <= latestBlock) {
    if (to > latestBlock) to = latestBlock;

    console.log(`Scanning blocks ${from} → ${to} ...`);

    const logs = await provider.getLogs({
      address: tokenAddress,
      fromBlock: Number(from),
      toBlock: Number(to),
      topics: [transferTopic],
    });

    console.log(`  Found ${logs.length} Transfer logs`);

    for (const log of logs) {
      try {
        await saveTransfer(log);
      } catch (err) {
        console.error("Error saving transfer", err);
      }
    }

    from = to + 1n;
    to = from + batchSize;
  }

  console.log("Indexing complete for this run.");
  await pool.end();
}

runIndexer().catch((err) => {
  console.error(err);
  process.exit(1);
});