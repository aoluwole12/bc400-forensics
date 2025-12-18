import type { Express } from "express";
import type { Pool } from "pg";

export function registerSecurityRulesRoute(app: Express, pool: Pool) {
  async function handler(_req: any, res: any) {
    const client = await pool.connect();
    try {
      const transfers24h = await client.query<{ n: string }>(
        `
        SELECT COUNT(*)::bigint AS n
        FROM transfers
        WHERE block_time >= NOW() - INTERVAL '24 hours';
        `
      );

      const newest = await client.query<{
        block_number: string;
        block_time: string | null;
      }>(
        `
        SELECT block_number::bigint AS block_number, block_time
        FROM transfers
        ORDER BY block_number DESC, log_index DESC
        LIMIT 1;
        `
      );

      const newestRow = newest.rows[0];

      return res.json({
        ok: true,
        version: "1",
        signals: {
          transfersLast24h: Number(transfers24h.rows[0]?.n || 0),
          newestIndexedTransfer: newestRow
            ? {
                blockNumber: Number(newestRow.block_number),
                blockTime: newestRow.block_time,
              }
            : null,
        },
        notes: [
          "v1 signals are DB-derived (indexer/backfill data).",
          "Next: wallet concentration deltas, whale flows, LP events, and re-org safety checks.",
        ],
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Error in /security/rules:", err);
      return res.status(500).json({
        error: "Failed to load security rules",
        details: String(err?.message || err),
      });
    } finally {
      client.release();
    }
  }

  app.get("/security/rules", handler);
  app.get("/api/security/rules", handler);
}