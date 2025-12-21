//import "dotenv/config";
import dotenv from "dotenv";
dotenv.config({ path: "src/.env" });
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";
import { pool } from "./db";

import { registerDexPriceRoute } from "./routes/dexPrice";
import { registerLpLockRoute } from "./routes/lpLock";
import { registerSecurityRulesRoute } from "./routes/securityRules";
import { registerLatestTransfersRoute } from "./routes/transfersLatest";
import { registerDexTotalsRoute } from "./routes/dexTotals";
import { registerSummaryRoute } from "./routes/summary";
import { registerDebugAddressesRoute } from "./routes/debugAddresses";

const PORT = Number(process.env.PORT || 4000);

const app = express();

// ✅ CORS: allow your production frontend + local dev
const allowedOrigins = [
  "https://www.bc400forensics.com",
  "https://bc400forensics.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser calls (curl, server-to-server) where origin is undefined
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ handle preflight
app.options("*", cors());

app.use(express.json());

function handleError(res: Response, where: string, err: unknown) {
  console.error(`Error in ${where}:`, err);
  res.status(500).json({
    error: `Failed to load ${where}`,
    details: err instanceof Error ? err.message : String(err),
  });
}

// Root homepage
app.get("/", (_req: Request, res: Response) => {
  res.status(200).type("html").send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BC400 Forensics API</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 32px; line-height: 1.5; }
    code { background: #f3f3f3; padding: 2px 6px; border-radius: 6px; }
    .card { max-width: 820px; border: 1px solid #e6e6e6; border-radius: 12px; padding: 18px; }
    ul { margin: 10px 0 0 18px; }
    a { text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h1>BC400 Forensics API</h1>
    <p class="muted">You reached the API service. Try these endpoints:</p>
    <ul>
      <li><a href="/health"><code>/health</code></a> (and <a href="/api/health"><code>/api/health</code></a>)</li>
      <li><a href="/summary"><code>/summary</code></a> (and <a href="/api/summary"><code>/api/summary</code></a>)</li>
      <li><a href="/top-holders"><code>/top-holders</code></a> (and <a href="/api/top-holders"><code>/api/top-holders</code></a>)</li>

      <li><a href="/transfers"><code>/transfers</code></a> (and <a href="/api/transfers"><code>/api/transfers</code></a>)</li>
      <li><a href="/transfers/latest"><code>/transfers/latest</code></a> (and <a href="/api/transfers/latest"><code>/api/transfers/latest</code></a>)</li>

      <li><a href="/dex/price"><code>/dex/price</code></a> (and <a href="/api/dex/price"><code>/api/dex/price</code></a>)</li>
      <li><a href="/lp/lock"><code>/lp/lock</code></a> (and <a href="/api/lp/lock"><code>/api/lp/lock</code></a>)</li>
      <li><a href="/security/rules"><code>/security/rules</code></a> (and <a href="/api/security/rules"><code>/api/security/rules</code></a>)</li>
    </ul>
    <p class="muted" style="margin-top: 14px;">Note: <code>/sql</code> is POST-only (SELECT-only).</p>
  </div>
</body>
</html>
  `);
});

// Health check
async function healthHandler(_req: Request, res: Response) {
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

// Summary
async function summaryHandler(_req: Request, res: Response) {
  const client = await pool.connect();
  try {
    const stats = await client.query<{
      first_block: string | null;
      last_block: string | null;
      total_transfers: string;
    }>(`
      SELECT
        MIN(block_number)::bigint AS first_block,
        MAX(block_number)::bigint AS last_block,
        COUNT(*)::bigint          AS total_transfers
      FROM transfers;
    `);

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

// Top holders
async function topHoldersHandler(req: Request, res: Response) {
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
      JOIN addresses a ON a.id = hb.address_id
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

// Transfers (simple latest list)
async function transfersHandler(req: Request, res: Response) {
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

// SQL console
app.post("/sql", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const sql = String((req.body as any)?.sql || "").trim();
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

// ✅ Route modules (this is what your frontend calls)
registerDexPriceRoute(app);
registerLpLockRoute(app);
registerSecurityRulesRoute(app, pool);
registerDexTotalsRoute(app, pool);
registerSummaryRoute(app, pool);
registerDebugAddressesRoute(app);

// ✅ Latest transfers (cursor pagination)
registerLatestTransfersRoute(app, pool);

app.listen(PORT, () => {
  console.log(`BC400 API listening on http://localhost:${PORT}`);
});
