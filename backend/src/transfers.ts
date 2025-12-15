import type { Express } from "express";
import type { Pool } from "pg";

export function registerTransfersRoute(app: Express, pool: Pool) {
  async function handler(req: any, res: any) {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    try {
      const q = await pool.query<{
        block_number: string;
        block_time: string | null;
        from_address: string;
        to_address: string;
        amount_bc400: string;
        tx_hash: string;
        log_index: number;
      }>(
        `
        SELECT
          t.block_number::text AS block_number,
          t.block_time::text   AS block_time,
          fa.address           AS from_address,
          ta.address           AS to_address,
          (t.raw_amount::numeric / 1e18)::text AS amount_bc400,
          t.tx_hash,
          t.log_index
        FROM transfers t
        JOIN addresses fa ON fa.id = t.from_address_id
        JOIN addresses ta ON ta.id = t.to_address_id
        ORDER BY t.block_number DESC, t.log_index DESC
        LIMIT $1
        `,
        [limit]
      );

      res.json(q.rows);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: "transfers_failed", details: err?.message ?? String(err) });
    }
  }

  // Support both routes so frontend can call either
  app.get("/transfers", handler);
  app.get("/api/transfers", handler);
}