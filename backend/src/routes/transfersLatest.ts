import type { Express, Request, Response } from "express";
import type { Pool } from "pg";

type LatestTransfersRow = {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_time: string; // timestamptz -> string
  from_address: string;
  to_address: string;
  raw_amount: string; // numeric/bigint -> string
};

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function registerLatestTransfersRoute(app: Express, pool: Pool) {
  // GET /transfers/latest?limit=50
  // GET /transfers/latest?limit=50&cursorBlock=72315776&cursorLog=468
  app.get("/transfers/latest", async (req: Request, res: Response) => {
    try {
      const limitRaw = String(req.query.limit ?? "50");
      const limit = clampInt(Number.parseInt(limitRaw, 10) || 50, 1, 200);

      const cursorBlockRaw = req.query.cursorBlock;
      const cursorLogRaw = req.query.cursorLog;

      const hasCursor =
        cursorBlockRaw !== undefined &&
        cursorLogRaw !== undefined &&
        String(cursorBlockRaw).length > 0 &&
        String(cursorLogRaw).length > 0;

      let cursorBlock = 0;
      let cursorLog = 0;

      if (hasCursor) {
        cursorBlock = Number.parseInt(String(cursorBlockRaw), 10);
        cursorLog = Number.parseInt(String(cursorLogRaw), 10);

        if (!Number.isFinite(cursorBlock) || !Number.isFinite(cursorLog)) {
          return res.status(400).json({
            error: "Invalid cursor values",
            details: "cursorBlock and cursorLog must be integers",
          });
        }
      }

      const sqlBase = `
        SELECT
          t.tx_hash,
          t.log_index,
          t.block_number,
          t.block_time,
          af.address AS from_address,
          at.address AS to_address,
          t.raw_amount
        FROM public.transfers t
        JOIN public.addresses af ON af.id = t.from_address_id
        JOIN public.addresses at ON at.id = t.to_address_id
      `;

      const sql = hasCursor
        ? `
          ${sqlBase}
          WHERE (t.block_number, t.log_index) < ($1, $2)
          ORDER BY t.block_number DESC, t.log_index DESC
          LIMIT $3;
        `
        : `
          ${sqlBase}
          ORDER BY t.block_number DESC, t.log_index DESC
          LIMIT $1;
        `;

      const params = hasCursor ? [cursorBlock, cursorLog, limit] : [limit];

      const { rows } = await pool.query<LatestTransfersRow>(sql, params);

      const last = rows.length ? rows[rows.length - 1] : null;
      const nextCursor = last
        ? { blockNumber: last.block_number, logIndex: last.log_index }
        : null;

      res.json({ items: rows, nextCursor });
    } catch (err: any) {
      console.error("Error in /transfers/latest:", err);
      res.status(500).json({
        error: "Failed to load latest transfers",
        details: err?.message ?? String(err),
      });
    }
  });

  // Alias: /api/transfers/latest
  app.get("/api/transfers/latest", async (req: Request, res: Response) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(307, `/transfers/latest${qs}`);
  });
}
