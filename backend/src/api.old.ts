import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const PORT = process.env.PORT || 4000;

// Default local Postgres connection – works with your Docker setup
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://bc400:bc400password@localhost:5432/bc400_forensics",
});

const app = express();
app.use(cors());
app.use(express.json());

// Simple health check
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * GET /summary
 *
 * Returns high-level chain stats for the Overview tab:
 * - firstBlock
 * - lastIndexedBlock
 * - totalWallets
 * - totalTransfers
 * - currentHolders (wallets with balance_bc400 > 0)
 */
app.get("/summary", async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `
        SELECT
          COALESCE(
            (SELECT value::bigint FROM meta WHERE key = 'first_block'),
            (SELECT MIN(block_number) FROM transfers)
          ) AS first_block,
          COALESCE(
            (SELECT value::bigint FROM meta WHERE key = 'last_indexed_block'),
            (SELECT MAX(block_number) FROM transfers)
          ) AS last_indexed_block,
          (SELECT COUNT(*) FROM addresses) AS total_wallets,
          (SELECT COUNT(*) FROM transfers) AS total_transfers,
          COALESCE(
            (SELECT COUNT(*) FROM holder_balances WHERE balance_bc400 > 0),
            0
          ) AS current_holders
      `
      );

      const row = rows[0] || {};

      res.json({
        firstBlock: row.first_block ?? null,
        lastIndexedBlock: row.last_indexed_block ?? null,
        totalWallets: Number(row.total_wallets || 0),
        totalTransfers: Number(row.total_transfers || 0),
        currentHolders: Number(row.current_holders || 0),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error in /summary:", err);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

/**
 * GET /top-holders
 * GET /api/top-holders   (alias for future-proofing)
 *
 * Returns top BC400 holders from holder_balances.
 * Optional query param: ?limit=50 (default 20)
 */
async function handleTopHolders(req: express.Request, res: express.Response) {
  const limit = Math.min(
    100,
    Math.max(1, Number(req.query.limit) || 20)
  );

  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `
        SELECT
          a.address,
          hb.balance_bc400,
          hb.first_seen,
          hb.last_seen,
          hb.tx_count
        FROM holder_balances hb
        JOIN addresses a ON a.id = hb.address_id
        WHERE hb.balance_bc400 > 0
        ORDER BY hb.balance_bc400 DESC
        LIMIT $1
      `,
        [limit]
      );

      // Shape response for your frontend <TopHolders> type
      const holders = rows.map((row: any, idx: number) => ({
        rank: idx + 1,
        address: row.address,
        balance_bc400: row.balance_bc400,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        tx_count: row.tx_count,
      }));

      res.json({ holders });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error in /top-holders:", err);
    res.status(500).json({ error: "Failed to load top holders" });
  }
}

app.get("/top-holders", handleTopHolders);
app.get("/api/top-holders", handleTopHolders);

/**
 * GET /transfers/recent
 *
 * Simple recent-transfers endpoint for the Transfers tab.
 */
app.get("/transfers/recent", async (req, res) => {
  const limit = Math.min(
    200,
    Math.max(1, Number(req.query.limit) || 50)
  );

  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `
        SELECT
          t.tx_hash,
          t.block_number,
          t.block_time,
          fa.address AS from_address,
          ta.address AS to_address,
          t.raw_amount
        FROM transfers t
        LEFT JOIN addresses fa ON fa.id = t.from_address_id
        LEFT JOIN addresses ta ON ta.id = t.to_address_id
        ORDER BY t.block_number DESC, t.log_index DESC
        LIMIT $1
      `,
        [limit]
      );

      res.json({ transfers: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error in /transfers/recent:", err);
    res.status(500).json({ error: "Failed to load transfers" });
  }
});

/**
 * POST /sql/query
 *
 * Very simple SQL console for your SQL tab.
 * NOTE: This is powerful and should only be exposed behind auth
 * in real production. For now it's just your internal tool.
 */
app.post("/sql/query", async (req, res) => {
  const { sql } = req.body || {};

  if (!sql || typeof sql !== "string") {
    return res.status(400).json({ error: "Missing 'sql' in request body" });
  }

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(sql);
      res.json({
        rowCount: result.rowCount,
        rows: result.rows,
        fields: result.fields.map((f) => f.name),
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("Error in /sql/query:", err);
    res.status(500).json({
      error: "SQL error",
      detail: err.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`BC400 API listening on http://localhost:${PORT}`);
});
