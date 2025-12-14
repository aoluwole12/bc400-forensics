import type { Express } from "express";
import type { Pool } from "pg";

export function registerSummaryRoute(app: Express, pool: Pool) {
  app.get("/api/summary", async (_req, res) => {
    try {
      const totals = await pool.query<{
        total_transfers: string;
        first_block: string | null;
        last_block: string | null;
      }>(`
        SELECT
          COUNT(*)::text AS total_transfers,
          MIN(block_number)::text AS first_block,
          MAX(block_number)::text AS last_block
        FROM transfers
      `);

      const wallets = await pool.query<{ total_wallets: string }>(`
        SELECT COUNT(*)::text AS total_wallets
        FROM addresses
      `);

      res.json({
        totalWallets: Number(wallets.rows[0]?.total_wallets ?? 0),
        totalTransfers: Number(totals.rows[0]?.total_transfers ?? 0),
        firstBlock: Number(totals.rows[0]?.first_block ?? 0),
        lastIndexedBlock: Number(totals.rows[0]?.last_block ?? 0),
      });
    } catch (err: any) {
      res.status(500).json({ error: "summary_failed", details: err?.message ?? String(err) });
    }
  });
}
