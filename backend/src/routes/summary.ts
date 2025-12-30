import type { Express } from "express";
import type { Pool } from "pg";

function normAddr(a: string) {
  return String(a || "").trim().toLowerCase();
}

function isEvmAddress(a: string) {
  return /^0x[a-f0-9]{40}$/.test(normAddr(a));
}

export function registerSummaryRoute(app: Express, pool: Pool) {
  async function handler(_req: any, res: any) {
    try {
      const pairAddress = normAddr(process.env.BC400_PAIR_ADDRESS || "");

      // Base summary (all-time)
      const base = await pool.query<{
        first_block: string | null;
        last_indexed_block: string | null;
        total_transfers: string;
        total_wallets: string;
      }>(`
        SELECT
          (SELECT MIN(block_number)::bigint FROM public.transfers) AS first_block,
          (SELECT MAX(block_number)::bigint FROM public.transfers) AS last_indexed_block,
          (SELECT COUNT(*)::bigint         FROM public.transfers) AS total_transfers,
          (SELECT COUNT(*)::bigint         FROM public.addresses) AS total_wallets
      `);

      let pairAddressId: number | null = null;

      // Defaults if pair not configured or not found
      let totalBoughtBc400Raw = "0"; // pair -> wallets (BUY)
      let totalSoldBc400Raw = "0";   // wallets -> pair (SELL)
      let totalBuyTransfers = 0;
      let totalSellTransfers = 0;

      if (isEvmAddress(pairAddress)) {
        // Resolve pair id first (fast lookup)
        const pairRow = await pool.query<{ id: number }>(
          `SELECT id FROM public.addresses WHERE lower(address) = $1 LIMIT 1;`,
          [pairAddress]
        );

        if (pairRow.rowCount > 0) {
          pairAddressId = pairRow.rows[0].id;

          const agg = await pool.query<{
            bought_raw: string;
            sold_raw: string;
            buy_count: string;
            sell_count: string;
          }>(
            `
            SELECT
              -- BUY = pair sends BC400 out to wallets
              COALESCE(SUM(CASE WHEN t.from_address_id = $1 THEN t.raw_amount::numeric ELSE 0 END), 0)::text AS bought_raw,
              -- SELL = wallets send BC400 into pair
              COALESCE(SUM(CASE WHEN t.to_address_id   = $1 THEN t.raw_amount::numeric ELSE 0 END), 0)::text AS sold_raw,

              COALESCE(COUNT(*) FILTER (WHERE t.from_address_id = $1), 0)::bigint::text AS buy_count,
              COALESCE(COUNT(*) FILTER (WHERE t.to_address_id   = $1), 0)::bigint::text AS sell_count
            FROM public.transfers t
            WHERE t.from_address_id = $1 OR t.to_address_id = $1;
            `,
            [pairAddressId]
          );

          totalBoughtBc400Raw = agg.rows[0]?.bought_raw ?? "0";
          totalSoldBc400Raw = agg.rows[0]?.sold_raw ?? "0";
          totalBuyTransfers = Number(agg.rows[0]?.buy_count ?? "0");
          totalSellTransfers = Number(agg.rows[0]?.sell_count ?? "0");
        }
      }

      const row = base.rows[0];

      return res.json({
        // chain/indexer coverage
        firstBlock: row?.first_block ? Number(row.first_block) : null,
        lastIndexedBlock: row?.last_indexed_block ? Number(row.last_indexed_block) : null,
        totalTransfers: row?.total_transfers ? Number(row.total_transfers) : 0,
        totalWallets: row?.total_wallets ? Number(row.total_wallets) : 0,

        // pair context (investor-grade)
        pairAddress: isEvmAddress(pairAddress) ? pairAddress : null,
        pairAddressId,

        definitions: {
          buy: "BC400 outflow from LP pair to wallets (users buying BC400)",
          sell: "BC400 inflow from wallets to LP pair (users selling BC400)",
          rawAmount: "Token raw units as stored in transfers.raw_amount (not human decimals)",
        },

        // all-time DEX flow totals (raw units)
        totalBoughtBc400Raw,
        totalSoldBc400Raw,
        totalBuyTransfers,
        totalSellTransfers,
      });
    } catch (err: any) {
      console.error("Error in /summary:", err);
      return res.status(500).json({
        error: "Failed to load summary",
        details: String(err?.message || err),
      });
    }
  }

  app.get("/summary", handler);
  app.get("/api/summary", handler);
}