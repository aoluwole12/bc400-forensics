// src/api.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db";

const PORT = Number(process.env.PORT || 4000);
const app = express();

// Allow frontend to call this API
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://bc400forensics.com",
      "https://www.bc400forensics.com",
    ],
  })
);
app.use(express.json());

// Simple health check
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(500).json({ ok: false });
  }
});

// ---------- SUMMARY CARDS ----------
app.get("/api/summary", async (_req, res) => {
  try {
    const walletsResult = await pool.query(
      "SELECT COUNT(*)::bigint AS count FROM addresses"
    );
    const transfersResult = await pool.query(
      "SELECT COUNT(*)::bigint AS count FROM transfers"
    );
    const blocksResult = await pool.query(
      "SELECT MIN(block_number)::bigint AS first, MAX(block_number)::bigint AS last FROM transfers"
    );

    res.json({
      totalWallets: Number(walletsResult.rows[0].count),
      totalTransfers: Number(transfersResult.rows[0].count),
      firstBlock: Number(blocksResult.rows[0].first),
      lastIndexedBlock: Number(blocksResult.rows[0].last),
    });
  } catch (err) {
    console.error("Error in /api/summary:", err);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

// ---------- TOP HOLDERS ----------
app.get("/api/top-holders", async (req, res) => {
  const limit = Number(req.query.limit || 8);

  const sql = `
    SELECT
      a.address,
      SUM(
        CASE WHEN t.to_address_id = a.id THEN t.raw_amount::numeric ELSE 0 END
      ) -
      SUM(
        CASE WHEN t.from_address_id = a.id THEN t.raw_amount::numeric ELSE 0 END
      ) AS balance_bc400
    FROM addresses a
    JOIN transfers t
      ON a.id = t.from_address_id OR a.id = t.to_address_id
    GROUP BY a.address
    HAVING
      SUM(CASE WHEN t.to_address_id = a.id THEN t.raw_amount::numeric ELSE 0 END) -
      SUM(CASE WHEN t.from_address_id = a.id THEN t.raw_amount::numeric ELSE 0 END) <> 0
    ORDER BY balance_bc400 DESC
    LIMIT $1;
  `;

  try {
    const result = await pool.query(sql, [limit]);
    res.json({
      holders: result.rows.map((row, idx) => ({
        rank: idx + 1,
        address: row.address,
        balance_bc400: row.balance_bc400,
      })),
    });
  } catch (err) {
    console.error("Error in /api/top-holders:", err);
    res.status(500).json({ error: "Failed to load top holders" });
  }
});

// ---------- LATEST TRANSFERS (wallet ↔ wallet + balances) ----------
app.get("/api/latest-transfers", async (req, res) => {
  const limit = Number(req.query.limit || 8);

  const sql = `
    WITH balances AS (
      SELECT
        a.id,
        a.address,
        SUM(
          CASE WHEN t.to_address_id = a.id THEN t.raw_amount::numeric ELSE 0 END
        ) -
        SUM(
          CASE WHEN t.from_address_id = a.id THEN t.raw_amount::numeric ELSE 0 END
        ) AS balance_bc400
      FROM addresses a
      JOIN transfers t
        ON a.id = t.from_address_id OR a.id = t.to_address_id
      GROUP BY a.id, a.address
    )
    SELECT
      t.block_number,
      t.block_time,
      from_addr.address AS from_address,
      COALESCE(fb.balance_bc400, 0) AS from_balance_bc400,
      to_addr.address   AS to_address,
      COALESCE(tb.balance_bc400, 0) AS to_balance_bc400,
      t.raw_amount::numeric AS amount_bc400
    FROM transfers t
    JOIN addresses from_addr ON t.from_address_id = from_addr.id
    JOIN addresses to_addr   ON t.to_address_id   = to_addr.id
    LEFT JOIN balances fb ON fb.id = from_addr.id
    LEFT JOIN balances tb ON tb.id = to_addr.id
    WHERE
      from_addr.address <> to_addr.address
      AND from_addr.address NOT IN (
        '0x0000000000000000000000000000000000000000',
        '0x000000000000000000000000000000000000dead'
      )
      AND to_addr.address NOT IN (
        '0x0000000000000000000000000000000000000000',
        '0x000000000000000000000000000000000000dead'
      )
    ORDER BY t.block_number DESC, t.log_index DESC
    LIMIT $1;
  `;

  try {
    const result = await pool.query(sql, [limit]);
    res.json({
      transfers: result.rows.map((row) => ({
        block_number: Number(row.block_number),
        block_time: row.block_time,
        from_address: row.from_address,
        from_balance_bc400: row.from_balance_bc400,
        to_address: row.to_address,
        to_balance_bc400: row.to_balance_bc400,
        amount_bc400: row.amount_bc400,
      })),
    });
  } catch (err) {
    console.error("Error in /api/latest-transfers:", err);
    res.status(500).json({ error: "Failed to load latest transfers" });
  }
});

// ---------- SQL playground endpoint (read-only) ----------
app.post("/api/sql", async (req, res) => {
  const { sql } = req.body as { sql?: string };

  if (!sql || typeof sql !== "string") {
    return res.status(400).json({ error: "sql field is required" });
  }

  // Very defensive: only allow SELECT, no mutations.
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT")) {
    return res
      .status(400)
      .json({ error: "Only read-only SELECT queries are allowed" });
  }

  try {
    const result = await pool.query(sql);
    res.json({ rows: result.rows });
  } catch (err) {
    console.error("Error in /api/sql:", err);
    res.status(500).json({ error: "Query failed", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`BC400 API listening on http://localhost:${PORT}`);
});