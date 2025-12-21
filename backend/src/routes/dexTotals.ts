import type { Express, Request, Response } from "express";
import type { Pool } from "pg";

function normalizeAddress(addr: string) {
  return String(addr || "").trim().toLowerCase();
}

export function registerDexTotalsRoute(app: Express, pool: Pool) {
  async function handler(_req: Request, res: Response) {
    const pair = normalizeAddress(process.env.BC400_PAIR_ADDRESS || "");
    if (!pair || !pair.startsWith("0x") || pair.length !== 42) {
      return res.status(400).json({
        error: "BC400_PAIR_ADDRESS not set (must be a 0x…42-char address)",
      });
    }

    const client = await pool.connect();
    try {
      // Resolve pair address_id
      const pairRow = await client.query<{ id: number }>(
        `SELECT id FROM addresses WHERE lower(address) = $1 LIMIT 1;`,
        [pair]
      );

      if (pairRow.rowCount === 0) {
        return res.status(200).json({
          pairAddress: pair,
          pairAddressId: null,
          totalBuys: 0,
          totalSells: 0,
          totalBoughtRaw: "0",
          totalSoldRaw: "0",
          note: "Pair not found in addresses table yet (backfill/indexer hasn't indexed it).",
        });
      }

      const pairId = pairRow.rows[0].id;

      // BUY = from pair -> to wallet
      // SELL = from wallet -> to pair
      const totals = await client.query<{
        total_buys: string;
        total_sells: string;
        total_bought_raw: string;
        total_sold_raw: string;
      }>(
        `
        SELECT
          COUNT(*) FILTER (WHERE t.from_address_id = $1) AS total_buys,
          COUNT(*) FILTER (WHERE t.to_address_id   = $1) AS total_sells,

          COALESCE(SUM(CASE WHEN t.from_address_id = $1 THEN t.raw_amount::numeric ELSE 0 END), 0)::text AS total_bought_raw,
          COALESCE(SUM(CASE WHEN t.to_address_id   = $1 THEN t.raw_amount::numeric ELSE 0 END), 0)::text AS total_sold_raw
        FROM transfers t
        WHERE t.from_address_id = $1 OR t.to_address_id = $1;
        `,
        [pairId]
      );

      const row = totals.rows[0];

      return res.json({
        pairAddress: pair,
        pairAddressId: pairId,
        totalBuys: Number(row?.total_buys || 0),
        totalSells: Number(row?.total_sells || 0),
        totalBoughtRaw: row?.total_bought_raw || "0",
        totalSoldRaw: row?.total_sold_raw || "0",
      });
    } catch (err) {
      console.error("Error in /dex/totals:", err);
      return res.status(500).json({
        error: "Failed to load dex totals",
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      client.release();
    }
  }

  app.get("/dex/totals", handler);
  app.get("/api/dex/totals", handler);
}
