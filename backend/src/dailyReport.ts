import type { Express, Request, Response } from "express";
import type { Pool } from "pg";

type DailyReport = {
  generatedAt: string;
  security: {
    criticalAlerts: boolean;
  };
  whales: {
    net_bc400: number;
    window_hours: number;
  };
  holders: {
    total_now: number;
    new_24h: number;
    pct_change_24h: number | null;
  };
  liquidity: {
    lock_percent: number;
    changed_24h: boolean;
  };
};

export function registerDailyReportRoute(app: Express, pool: Pool) {
  app.get("/daily-report", async (_req: Request, res: Response) => {
    try {
      // 1) Total current holders (positive balance in holder_balances)
      const holdersNowResult = await pool.query(
        `
        SELECT COUNT(*)::bigint AS total_holders
        FROM holder_balances
        WHERE balance_bc400::numeric > 0
        `
      );

      // 2) New holders whose first *incoming* transfer is within last 24h
      const newHoldersResult = await pool.query(
        `
        WITH cutoff AS (
          SELECT now() - interval '24 hours' AS ts
        ),
        first_incoming AS (
          SELECT
            t.to_address_id,
            MIN(t.block_time) AS first_seen
          FROM transfers t
          GROUP BY t.to_address_id
        )
        SELECT COUNT(*)::bigint AS new_holders
        FROM first_incoming fi, cutoff c
        WHERE fi.first_seen >= c.ts
        `
      );

      // 3) Whale net flow over last 24h (top 25 holders by balance)
      const whaleNetResult = await pool.query(
        `
        WITH cutoff AS (
          SELECT now() - interval '24 hours' AS ts
        ),
        whales AS (
          SELECT address_id
          FROM holder_balances
          ORDER BY balance_bc400::numeric DESC
          LIMIT 25
        ),
        recent AS (
          SELECT
            t.from_address_id,
            t.to_address_id,
            t.raw_amount::numeric AS amount
          FROM transfers t, cutoff c
          WHERE t.block_time >= c.ts
        ),
        inflow AS (
          SELECT COALESCE(SUM(r.amount), 0) AS amount
          FROM recent r
          JOIN whales w ON r.to_address_id = w.address_id
        ),
        outflow AS (
          SELECT COALESCE(SUM(r.amount), 0) AS amount
          FROM recent r
          JOIN whales w ON r.from_address_id = w.address_id
        )
        SELECT
          ((inflow.amount - outflow.amount) / 1e18::numeric) AS net_bc400
        FROM inflow, outflow
        `
      );

      const totalNow = Number(
        holdersNowResult.rows[0]?.total_holders ?? 0
      );
      const new24h = Number(
        newHoldersResult.rows[0]?.new_holders ?? 0
      );
      const prev = totalNow - new24h;
      const pctChange =
        prev > 0 ? (new24h / prev) * 100 : null;

      const netWhales = Number(
        whaleNetResult.rows[0]?.net_bc400 ?? 0
      );

      const payload: DailyReport = {
        generatedAt: new Date().toISOString(),
        security: {
          // TODO: hook this to a real security_alerts table later
          criticalAlerts: false,
        },
        whales: {
          net_bc400: netWhales,
          window_hours: 24,
        },
        holders: {
          total_now: totalNow,
          new_24h: new24h,
          pct_change_24h: pctChange,
        },
        liquidity: {
          // TODO: wire to real LP lock tracking
          lock_percent: 100,
          changed_24h: false,
        },
      };

      res.json(payload);
    } catch (err) {
      console.error("Error building /daily-report", err);
      res.status(500).json({
        error: "Failed to build daily report",
      });
    }
  });
}
