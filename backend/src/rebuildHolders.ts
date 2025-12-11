import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://bc400:bc400password@localhost:5432/bc400_forensics";

const pool = new Pool({ connectionString });

async function rebuildHolderBalances() {
  console.log("=== Rebuilding holder_balances from transfers ===");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Clear existing snapshot so we don't get duplicates
    await client.query("TRUNCATE TABLE holder_balances;");

    // 2) Rebuild from transfers + addresses
    const result = await client.query(`
      WITH agg AS (
        SELECT
          a.id AS address_id,
          -- net raw token balance
          SUM(
            CASE WHEN t.to_address_id = a.id
              THEN t.raw_amount::numeric
              ELSE 0
            END
          ) -
          SUM(
            CASE WHEN t.from_address_id = a.id
              THEN t.raw_amount::numeric
              ELSE 0
            END
          ) AS balance_raw,
          COUNT(*)::int AS tx_count,
          MIN(t.block_time) AS first_seen,
          MAX(t.block_time) AS last_seen
        FROM addresses a
        JOIN transfers t
          ON t.to_address_id = a.id OR t.from_address_id = a.id
        GROUP BY a.id
        HAVING
          SUM(
            CASE WHEN t.to_address_id = a.id
              THEN t.raw_amount::numeric
              ELSE 0
            END
          ) -
          SUM(
            CASE WHEN t.from_address_id = a.id
              THEN t.raw_amount::numeric
              ELSE 0
            END
          ) > 0
      )
      INSERT INTO holder_balances (
        address_id,
        balance_raw,
        balance_bc400,
        tx_count,
        tags,
        first_seen,
        last_seen,
        last_block_number,
        last_block_time,
        last_tx_hash
      )
      SELECT
        agg.address_id,
        agg.balance_raw,
        -- If BC400 has a different decimals value, change 1e18 here
        agg.balance_raw / 1e18::numeric AS balance_bc400,
        agg.tx_count,
        'none' AS tags,
        agg.first_seen,
        agg.last_seen,
        last_tx.block_number,
        last_tx.block_time,
        last_tx.tx_hash
      FROM agg
      LEFT JOIN LATERAL (
        SELECT
          t.block_number,
          t.block_time,
          t.tx_hash
        FROM transfers t
        WHERE t.to_address_id = agg.address_id
           OR t.from_address_id = agg.address_id
        ORDER BY t.block_number DESC, t.log_index DESC
        LIMIT 1
      ) AS last_tx ON TRUE
      ORDER BY agg.balance_raw DESC;
    `);

    await client.query("COMMIT");

    console.log(
      "holder_balances rebuild COMPLETE - inserted " +
        result.rowCount +
        " rows.",
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Fatal error in rebuildHolders script:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

rebuildHolderBalances().catch((err) => {
  console.error("Unexpected error in rebuildHolderBalances():", err);
  process.exitCode = 1;
});
