import type { Express } from "express";
import type { Pool } from "pg";

export function registerHealthRoute(app: Express, pool: Pool) {
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, db: "ok" });
    } catch (err: any) {
      res.status(500).json({ ok: false, db: "down", details: err?.message ?? String(err) });
    }
  });
}
