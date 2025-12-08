import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

// Support both PG_* and DB_* env names
const host = process.env.PGHOST || process.env.DB_HOST || "localhost";
const port = Number(process.env.PGPORT || process.env.DB_PORT || 5432);
const user = process.env.PGUSER || process.env.DB_USER || "bc400";
const password =
  process.env.PGPASSWORD || process.env.DB_PASSWORD || "bc400password";
const database =
  process.env.PGDATABASE || process.env.DB_NAME || "bc400_forensics";

export const pool = new Pool({
  host,
  port,
  user,
  password,
  database,
});

export async function testConnection() {
  const res = await pool.query("SELECT NOW()");
  console.log("✅ DB connected, time is:", res.rows[0].now);
}

// Ensure an address exists in `addresses` and update first/last_seen_block.
// Returns the address id.
export async function getOrCreateAddress(
  address: string,
  blockNumber: bigint
): Promise<number> {
  const lower = address.toLowerCase();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, first_seen_block, last_seen_block
       FROM addresses
       WHERE address = $1
       FOR UPDATE`,
      [lower]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      const first = row.first_seen_block
        ? BigInt(row.first_seen_block)
        : blockNumber;
      const last = row.last_seen_block
        ? BigInt(row.last_seen_block)
        : blockNumber;

      const newFirst = blockNumber < first ? blockNumber : first;
      const newLast = blockNumber > last ? blockNumber : last;

      const updated = await client.query(
        `UPDATE addresses
         SET first_seen_block = $1, last_seen_block = $2
         WHERE id = $3
         RETURNING id`,
        [newFirst.toString(), newLast.toString(), row.id]
      );

      await client.query("COMMIT");
      return updated.rows[0].id;
    } else {
      const insert = await client.query(
        `INSERT INTO addresses (address, first_seen_block, last_seen_block)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [
          lower,
          blockNumber.toString(),
          blockNumber.toString(),
        ]
      );

      await client.query("COMMIT");
      return insert.rows[0].id;
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}