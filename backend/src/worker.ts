import dotenv from "dotenv";
dotenv.config();

import { pool } from "./db";
import { startSupplySnapshotCron } from "./cron/supplySnapshotCron";

async function main() {
  console.log("🟣 Worker starting...");

  // ✅ Quick DB test
  try {
    const r = await pool.query("SELECT NOW() as now");
    console.log("✅ DB OK:", r.rows[0]?.now);
  } catch (e) {
    console.error("❌ DB connection failed:", e);
    process.exit(1);
  }

  // ✅ Start cron (your function checks ENABLE_SUPPLY_SNAPSHOT_CRON)
  startSupplySnapshotCron(pool);
  console.log("✅ Supply snapshot worker is running.");

  // ✅ Keep the process alive (works reliably on Render)
  setInterval(() => {
    console.log("🟡 Worker heartbeat:", new Date().toISOString());
  }, 60_000);

  // ✅ Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`🛑 Worker received ${signal}, shutting down...`);
    try {
      await pool.end();
    } catch {}
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("❌ Worker crashed:", err);
  process.exit(1);
});