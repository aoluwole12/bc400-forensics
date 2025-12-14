import type { Express } from "express";
import type { Pool } from "pg";

export function registerTopHoldersRoute(app: Express, pool: Pool) {
  app.get("/api/top-holders", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);

    try {
      const q = await pool.query<{
        rank: number;
        address: string;
        balance_bc400: string;
        tx_count: number | null;
        first_seen: string | null;
        last_seen: string | null;
      }>(`
        SELECT
          ROW_NUMBER() OVER (ORDER BY hb.balance_bc400 DESC) AS rank,
          a.address AS address,
          hb.balance_bc400::text AS balance_bc400,
          hb.tx_count,
          hb.first_seen::text AS first_seen,
          hb.last_seen::text AS last_seen
        FROM holder_balances hb
        JOIN addresses a ON a.id = hb.address_id
        ORDER BY hb.balance_bc400 DESC
        LIMIT $1
      `, [limit]);

      res.json(q.rows);
    } catch (err: any) {
      res.status(500).json({ error: "top_holders_failed", details: err?.message ?? String(err) });
    }
  });
}
