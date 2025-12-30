import type { Express, Request, Response } from "express";
import type { Pool } from "pg";

function normalizeAddress(addr: string) {
  return String(addr || "").trim().toLowerCase();
}

function parseCsvAddrs(v: string | undefined) {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => normalizeAddress(s))
    .filter((s) => s.startsWith("0x") && s.length === 42);
}

export function registerDexTotalsRoute(app: Express, pool: Pool) {
  async function handler(_req: Request, res: Response) {
    const pair = normalizeAddress(process.env.BC400_PAIR_ADDRESS || "");
if (!/^0x[a-f0-9]{40}$/.test(pair)) {	return res.status(400).json({
        error: "BC400_PAIR_ADDRESS not set (must be a 0x…42-char address)",
      });
    }

    // Optional: exclude special wallets by address (comma-separated)
    // DEX_TOTALS_EXCLUDE_ADDRS=0x000...dead,0xb197...cbb
    const excludeAddrs = parseCsvAddrs(process.env.DEX_TOTALS_EXCLUDE_ADDRS);

    const client = await pool.connect();
    try {
      // Resolve pair address_id
      const pairRow = await client.query<{ id: number }>(
        `SELECT id FROM public.addresses WHERE lower(address) = $1 LIMIT 1;`,
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

      // Map exclude addresses -> exclude address_ids (if present in DB)
      let excludeIds: number[] = [];
      if (excludeAddrs.length) {
        const ex = await client.query<{ id: number }>(
          `SELECT id FROM public.addresses WHERE lower(address) = ANY($1::text[]);`,
          [excludeAddrs]
        );
        excludeIds = ex.rows.map((r) => r.id);
      }

      // BUY: pair -> wallet  (from_address_id = pairId)
      // SELL: wallet -> pair (to_address_id   = pairId)
      //
      // Exclusion rule:
      // - exclude buys where the RECEIVER is a special wallet
      // - exclude sells where the SENDER is a special wallet
      const totals = await client.query<{
        total_buys: string;
        total_sells: string;
        total_bought_raw: string;
        total_sold_raw: string;
      }>(
        `
        SELECT
          COUNT(*) FILTER (
            WHERE t.from_address_id = $1
              AND t.to_address_id IS NOT NULL
              AND NOT (t.to_address_id = ANY($2::int[]))
          ) AS total_buys,

          COUNT(*) FILTER (
            WHERE t.to_address_id = $1
              AND t.from_address_id IS NOT NULL
              AND NOT (t.from_address_id = ANY($2::int[]))
          ) AS total_sells,

          COALESCE(SUM(
            CASE
              WHEN t.from_address_id = $1
               AND t.to_address_id IS NOT NULL
               AND NOT (t.to_address_id = ANY($2::int[]))
              THEN t.raw_amount::numeric
              ELSE 0
            END
          ), 0)::text AS total_bought_raw,

          COALESCE(SUM(
            CASE
              WHEN t.to_address_id = $1
               AND t.from_address_id IS NOT NULL
               AND NOT (t.from_address_id = ANY($2::int[]))
              THEN t.raw_amount::numeric
              ELSE 0
            END
          ), 0)::text AS total_sold_raw
        FROM public.transfers t
        WHERE t.from_address_id = $1 OR t.to_address_id = $1;
        `,
        [pairId, excludeIds] // ✅ always array, can be []
      );

      const row = totals.rows[0];

      return res.json({
        pairAddress: pair,
        pairAddressId: pairId,
        definitions: {
          buy: "BC400 outflow from LP pair to wallets (users buying BC400)",
          sell: "BC400 inflow from wallets to LP pair (users selling BC400)",
          excludedAddresses: excludeAddrs,
          excludedAddressIds: excludeIds,
        },
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