import "dotenv/config";
import { Pool, PoolClient } from "pg";

export const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "bc400",
  password: process.env.DB_PASSWORD || "bc400password",
  database: process.env.DB_NAME || "bc400_forensics",
});

/**
 * getOrCreateAddress
 *
 *  - backfill style:  getOrCreateAddress(address, client: PoolClient)
 *  - indexer style:   getOrCreateAddress(address, firstSeenBlock: bigint | undefined)
 *
 * If the second argument is a real PoolClient (has .query), we use it.
 * Otherwise we ignore it and create our own client from the pool.
 */
export async function getOrCreateAddress(
  address: string,
  clientOrSomething?: PoolClient | bigint
): Promise<number> {
  const lower = address.toLowerCase();

  let localClient: PoolClient;
  let releaseAfter = false;

  // If caller gave us a real PoolClient (backfill), use it.
  if (
    clientOrSomething &&
    typeof (clientOrSomething as any).query === "function"
  ) {
    localClient = clientOrSomething as PoolClient;
  } else {
    // Otherwise (indexer passing a bigint, or nothing) create our own client.
    localClient = await pool.connect();
    releaseAfter = true;
  }

  try {
    const existing = await localClient.query(
      "SELECT id FROM addresses WHERE address = $1",
      [lower]
    );
    if (existing.rowCount > 0) {
      return existing.rows[0].id as number;
    }

    const inserted = await localClient.query(
      "INSERT INTO addresses (address) VALUES ($1) RETURNING id",
      [lower]
    );
    return inserted.rows[0].id as number;
  } finally {
    if (releaseAfter && localClient) {
      localClient.release();
    }
  }
}