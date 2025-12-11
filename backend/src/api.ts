import express from "express";
import cors from "cors";
import { Pool } from "pg";

const PORT = Number(process.env.PORT || 4000);

// Use DATABASE_URL if present (Render style), otherwise local docker Postgres
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://bc400:bc400password@localhost:5432/bc400_forensics",
});

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
// Health check
// ----------------------
app.get("/health", async (_req, res) => {
  try {
    const client = await pool.connect();
    client.release();
    res.json({ ok: true });
  } catch (err) {
    handleError(res, "health", err);
  }
});

// ----------------------
// /summary – chain snapshot
// ----------------------
app.get("/summary", async (_req, res) => {
  const client = await pool.connect();
  try {
    // First/last block + total transfers from transfers table
    const stats = await client.query<{
      first_block: string | null;
      last_block: string | null;
      total_transfers: string;
    }>(
      `
      SELECT
        MIN(block_number)::bigint AS first_block,
        MAX(block_number)::bigint AS last_block,
        COUNT(*)::bigint       AS total_transfers
      FROM transfers;
    `,
    );

    const row = stats.rows[0];

    // Total wallets from addresses table
    const wallets = await client.query<{ total_wallets: string }>(
      `SELECT COUNT(*)::bigint AS total_wallets FROM addresses;`,
    );

    res.json({
      firstBlock: row?.first_block ? Number(row.first_block) : null,
      lastIndexedBlock: row?.last_block ? Number(row.last_block) : null,
      totalTransfers: row ? Number(row.total_transfers) : 0,
      totalWallets: wallets.rows[0]
        ? Number(wallets.rows[0].total_wallets)
        : 0,
    });
  } catch (err) {
    handleError(res, "summary", err);
  } finally {
    client.release();
  }
});

// ----------------------
// /top-holders – from holder_balances
// ----------------------
app.get("/top-holders", async (req, res) => {
  const client = await pool.connect();
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 25, 1),
      200,
    );

    // 1) Get the snapshot time (when this holder_balances view is current).
    //    We use the max last_block_time across the snapshot.
    const snapshotResult = await client.query<{
      snapshot_time: string | null;
    }>(
      `
      SELECT MAX(last_block_time) AS snapshot_time
      FROM holder_balances;
    `,
    );

    const snapshotUpdatedAt =
      snapshotResult.rows[0]?.snapshot_time ?? null;

    // 2) Get the actual holders list
    const result = await client.query<
      {
        address_id: number;
        address: string;
        balance_bc400: string;
        balance_raw: string;
        first_seen: string;
        last_seen: string;
        tx_count: number;
        last_block_number: string | null;
        last_block_time: string | null;
        last_tx_hash: string | null;
        tags: string | null;
      }
    >(
      `
      SELECT
        hb.address_id,
        a.address,
        hb.balance_bc400,
        hb.balance_raw,
        hb.first_seen,
        hb.last_seen,
        hb.tx_count,
        hb.last_block_number,
        hb.last_block_time,
        hb.last_tx_hash,
        COALESCE(string_agg(wt.tag, ',' ORDER BY wt.tag), '') AS tags
      FROM holder_balances hb
      JOIN addresses a
        ON a.id = hb.address_id
      LEFT JOIN wallet_tags wt
        ON wt.address_id = hb.address_id
      WHERE hb.balance_bc400 > 0
      GROUP BY
        hb.address_id,
        a.address,
        hb.balance_bc400,
        hb.balance_raw,
        hb.first_seen,
        hb.last_seen,
        hb.tx_count,
        hb.last_block_number,
        hb.last_block_time,
        hb.last_tx_hash
      ORDER BY hb.balance_bc400 DESC
      LIMIT $1;
    `,
      [limit],
    );

    res.json({
      snapshotUpdatedAt,
      holders: result.rows.map((r, idx) => ({
        rank: idx + 1,
        addressId: r.address_id,
        address: r.address,
        balanceBc400: r.balance_bc400,
        balanceRaw: r.balance_raw,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        txCount: r.tx_count,
        lastBlockNumber: r.last_block_number
          ? Number(r.last_block_number)
          : null,
        lastBlockTime: r.last_block_time,
        lastTxHash: r.last_tx_hash,
        tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
      })),
    });
  } catch (err) {
    handleError(res, "top holders", err);
  } finally {
    client.release();
  }
});

// ----------------------
// /transfers – recent transfers
// ----------------------
app.get("/transfers", async (req, res) => {
  const client = await pool.connect();
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      500,
    );

    const result = await client.query<
      {
        block_number: string;
        block_time: string;
        tx_hash: string;
        from_address: string | null;
        to_address: string | null;
        raw_amount: string;
      }
    >(
      `
      SELECT
        t.block_number,
        t.block_time,
        t.tx_hash,
        af.address AS from_address,
        at.address AS to_address,
        t.raw_amount
      FROM transfers t
      LEFT JOIN addresses af ON af.id = t.from_address_id
      LEFT JOIN addresses at ON at.id = t.to_address_id
      ORDER BY t.block_number DESC, t.log_index DESC
      LIMIT $1;
    `,
      [limit],
    );

    res.json({
      transfers: result.rows.map((r) => ({
        blockNumber: Number(r.block_number),
        blockTime: r.block_time,
        txHash: r.tx_hash,
        fromAddress: r.from_address,
        toAddress: r.to_address,
        rawAmount: r.raw_amount,
      })),
    });
  } catch (err) {
    handleError(res, "transfers", err);
  } finally {
    client.release();
  }
});

// ----------------------
// /sql – simple SELECT-only console
// ----------------------
app.post("/sql", async (req, res) => {
  const client = await pool.connect();
  try {
    const sql = String(req.body?.sql || "").trim();

    // Very basic safety: allow SELECT only
    if (!sql.toLowerCase().startsWith("select")) {
      return res
        .status(400)
        .json({ error: "Only SELECT queries are allowed" });
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