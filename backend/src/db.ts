import "dotenv/config";
import { Pool, PoolClient } from "pg";

// Prefer a single DATABASE_URL (works for Render + local)
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://bc400:bc400password@localhost:5432/bc400_forensics";

export const pool = new Pool({
  connectionString,
  // Render Postgres needs SSL
  ssl: connectionString.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
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

  if (
    clientOrSomething &&
    typeof (clientOrSomething as any).query === "function"
  ) {
    // Backfill passed a real client
    localClient = clientOrSomething as PoolClient;
  } else {
    // Indexer or generic call – create our own client
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