import type { Express } from "express";
import type { Pool } from "pg";

function normAddr(a: string) {
  return (a || "").trim().toLowerCase();
}

export function registerSummaryRoute(app: Express, pool: Pool) {
  app.get("/summary", async (_req, res) => {
    try {
      const pairAddress = normAddr(process.env.BC400_PAIR_ADDRESS || "");

      // Existing summary pieces (adjust column names if yours differ)
      const base = await pool.query<{
        first_block: number | null;
        last_indexed_block: number | null;
        total_transfers: number;
        total_wallets: number;
      }>(`
        SELECT
          (SELECT MIN(block_number) FROM public.transfers) AS first_block,
          (SELECT MAX(block_number) FROM public.transfers) AS last_indexed_block,
          (SELECT COUNT(*)::int FROM public.transfers) AS total_transfers,
          (SELECT COUNT(*)::int FROM public.addresses) AS total_wallets
      `);

      let totalBoughtBc400Raw = "0";
      let totalSoldBc400Raw = "0";
      let totalBuyTransfers = 0;
      let totalSellTransfers = 0;

      // If we have the pair address, compute BUY/SELL aggregates "to date"
      if (pairAddress) {
        const agg = await pool.query<{
          bought_raw: string;
          sold_raw: string;
          buy_count: number;
          sell_count: number;
        }>(`
          WITH pair AS (
            SELECT id
            FROM public.addresses
            WHERE LOWER(address) = $1
            LIMIT 1
          )
          SELECT
            COALESCE(SUM(CASE WHEN t.from_address_id = (SELECT id FROM pair) THEN t.raw_amount::numeric ELSE 0 END), 0)::text AS bought_raw,
            COALESCE(SUM(CASE WHEN t.to_address_id   = (SELECT id FROM pair) THEN t.raw_amount::numeric ELSE 0 END), 0)::text AS sold_raw,
            COALESCE(SUM(CASE WHEN t.from_address_id = (SELECT id FROM pair) THEN 1 ELSE 0 END), 0)::int AS buy_count,
            COALESCE(SUM(CASE WHEN t.to_address_id   = (SELECT id FROM pair) THEN 1 ELSE 0 END), 0)::int AS sell_count
          FROM public.transfers t
          WHERE (SELECT id FROM pair) IS NOT NULL
        `, [pairAddress]);

        totalBoughtBc400Raw = agg.rows[0]?.bought_raw ?? "0";
        totalSoldBc400Raw = agg.rows[0]?.sold_raw ?? "0";
        totalBuyTransfers = agg.rows[0]?.buy_count ?? 0;
        totalSellTransfers = agg.rows[0]?.sell_count ?? 0;
      }

      const row = base.rows[0];
      res.json({
        firstBlock: row?.first_block ?? null,
        lastIndexedBlock: row?.last_indexed_block ?? null,
        totalTransfers: row?.total_transfers ?? 0,
        totalWallets: row?.total_wallets ?? 0,

        // ✅ New fields
        totalBoughtBc400Raw,
        totalSoldBc400Raw,
        totalBuyTransfers,
        totalSellTransfers,
      });
    } catch (err: any) {
      console.error("Error in /summary:", err);
      res.status(500).json({ error: "Failed to load summary", details: String(err?.message || err) });
    }
  });
}
