import type { Express } from "express";
import type { Pool } from "pg";

export function registerDailyReportRoute(app: Express, pool: Pool) {
  app.get("/api/daily-report", async (_req, res) => {
    try {
      const q = await pool.query<{
        transfers_24h: string;
        unique_from_24h: string;
        unique_to_24h: string;
        last_block: string | null;
      }>(`
        WITH last24 AS (
          SELECT *
          FROM transfers
          WHERE block_time >= NOW() - INTERVAL '24 hours'
        )
        SELECT
          (SELECT COUNT(*)::text FROM last24) AS transfers_24h,
          (SELECT COUNT(DISTINCT from_address_id)::text FROM last24) AS unique_from_24h,
          (SELECT COUNT(DISTINCT to_address_id)::text FROM last24) AS unique_to_24h,
          (SELECT MAX(block_number)::text FROM transfers) AS last_block
      `);

      res.json({
        transfers24h: Number(q.rows[0]?.transfers_24h ?? 0),
        uniqueFrom24h: Number(q.rows[0]?.unique_from_24h ?? 0),
        uniqueTo24h: Number(q.rows[0]?.unique_to_24h ?? 0),
        lastIndexedBlock: Number(q.rows[0]?.last_block ?? 0),
      });
    } catch (err: any) {
      res.status(500).json({ error: "daily_report_failed", details: err?.message ?? String(err) });
    }
  });
}
