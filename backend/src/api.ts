import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db";

const PORT = Number(process.env.PORT || 4000);

const app = express();
app.use(cors());
app.use(express.json());

// Small helper for logging + consistent error JSON
function handleError(res: express.Response, where: string, err: unknown) {
  console.error(`Error in ${where}:`, err);
  res.status(500).json({
    error: `Failed to load ${where}`,
    details: err instanceof Error ? err.message : String(err),
  });
}

// ----------------------
// Health check (support both /health and /api/health)
// ----------------------
async function healthHandler(_req: express.Request, res: express.Response) {
  try {
    const client = await pool.connect();
    client.release();
    res.json({ ok: true });
  } catch (err) {
    handleError(res, "health", err);
  }
}
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

// ----------------------
// /summary – chain snapshot (support /api/summary too)
// ----------------------
async function summaryHandler(_req: express.Request, res: express.Response) {
  const client = await pool.connect();
  try {
    const stats = await client.query<{
      first_block: string | null;
      last_block: string | null;
      total_transfers: string;
    }>(
      `
      SELECT
        MIN(block_number)::bigint AS first_block,
        MAX(block_number)::bigint AS last_block,
        COUNT(*)::bigint          AS total_transfers
      FROM transfers;
      `
    );

    const row = stats.rows[0];

    const wallets = await client.query<{ total_wallets: string }>(
      `SELECT COUNT(*)::bigint AS total_wallets FROM addresses;`
    );

    res.json({
      firstBlock: row?.first_block ? Number(row.first_block) : null,
      lastIndexedBlock: row?.last_block ? Number(row.last_block) : null,
      totalTransfers: row ? Number(row.total_transfers) : 0,
      totalWallets: wallets.rows[0] ? Number(wallets.rows[0].total_wallets) : 0,
    });
  } catch (err) {
    handleError(res, "summary", err);
  } finally {
    client.release();
  }
}
app.get("/summary", summaryHandler);
app.get("/api/summary", summaryHandler);

// ----------------------
// /top-holders – from holder_balances snapshot (support /api/top-holders too)
// ----------------------
async function topHoldersHandler(req: express.Request, res: express.Response) {
  const client = await pool.connect();
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);

    const result = await client.query<{
      address_id: number;
      address: string;
      balance_bc400: string;
      balance_raw: string;
      tx_count: number;
      tags: string | null;
      first_seen: string;
      last_seen: string;
      last_block_number: string | null;
      last_block_time: string | null;
      last_tx_hash: string | null;
    }>(
      `
      SELECT
        hb.address_id,
        a.address,
        hb.balance_bc400,
        hb.balance_raw,
        hb.tx_count,
        hb.tags,
        hb.first_seen,
        hb.last_seen,
        hb.last_block_number,
        hb.last_block_time,
        hb.last_tx_hash
      FROM holder_balances hb
      JOIN addresses a
        ON a.id = hb.address_id
      WHERE hb.balance_bc400 > 0
      ORDER BY hb.balance_bc400 DESC
      LIMIT $1;
      `,
      [limit]
    );

    res.json({
      holders: result.rows.map((r, idx) => ({
        rank: idx + 1,
        addressId: r.address_id,
        address: r.address,
        balanceBc400: r.balance_bc400,
        balanceRaw: r.balance_raw,
        txCount: r.tx_count,
        tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        lastBlockNumber: r.last_block_number ? Number(r.last_block_number) : null,
        lastBlockTime: r.last_block_time,
        lastTxHash: r.last_tx_hash,
      })),
    });
  } catch (err) {
    handleError(res, "top holders", err);
  } finally {
    client.release();
  }
}
app.get("/top-holders", topHoldersHandler);
app.get("/api/top-holders", topHoldersHandler);

// ----------------------
// /transfers – recent transfers (support /api/transfers too)
// ----------------------
async function transfersHandler(req: express.Request, res: express.Response) {
  const client = await pool.connect();
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);

    const result = await client.query<{
      block_number: string;
      block_time: string | null;
      tx_hash: string;
      from_address: string | null;
      to_address: string | null;
      raw_amount: string;
      log_index: number;
    }>(
      `
      SELECT
        t.block_number,
        t.block_time,
        t.tx_hash,
        af.address AS from_address,
        at.address AS to_address,
        t.raw_amount,
        t.log_index
      FROM transfers t
      LEFT JOIN addresses af ON af.id = t.from_address_id
      LEFT JOIN addresses at ON at.id = t.to_address_id
      ORDER BY t.block_number DESC, t.log_index DESC
      LIMIT $1;
      `,
      [limit]
    );

    // Return BOTH shapes for compatibility:
    // - Your frontend normalizer accepts many keys
    // - Keep "transfers" wrapper like you already had
    res.json({
      transfers: result.rows.map((r) => ({
        block_number: Number(r.block_number),
        block_time: r.block_time,
        tx_hash: r.tx_hash,
        from_address: r.from_address,
        to_address: r.to_address,
        raw_amount: r.raw_amount,
      })),
    });
  } catch (err) {
    handleError(res, "transfers", err);
  } finally {
    client.release();
  }
}
app.get("/transfers", transfersHandler);
app.get("/api/transfers", transfersHandler);

// ----------------------
// /sql – simple SELECT-only console
// ----------------------
app.post("/sql", async (req, res) => {
  const client = await pool.connect();
  try {
    const sql = String(req.body?.sql || "").trim();
    if (!sql.toLowerCase().startsWith("select")) {
      return res.status(400).json({ error: "Only SELECT queries are allowed" });
    }

    const result = await client.query(sql);
    res.json({
      rowCount: result.rowCount,
      rows: result.rows,
      fields: result.fields.map((f) => f.name),
    });
  } catch (err) {
    handleError(res, "sql console", err);
  } finally {
    client.release();
  }
});

// ----------------------
// Start server
// ----------------------
app.listen(PORT, () => {
  console.log(`BC400 API listening on http://localhost:${PORT}`);
});