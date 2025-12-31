import dotenv from "dotenv";
dotenv.config();

import { pool } from "./db";
import { startSupplySnapshotCron } from "./cron/supplySnapshotCron";

async function main() {
  console.log("🟣 Worker starting...");

  // Optional: quick DB test
  try {
    const r = await pool.query("SELECT NOW() as now");
    console.log("✅ DB OK:", r.rows[0]?.now);
  } catch (e) {
    console.error("❌ DB connection failed:", e);
    process.exit(1);
  }

  // Start the cron (your function already checks ENABLE_SUPPLY_SNAPSHOT_CRON)
  startSupplySnapshotCron(pool);

  console.log("✅ Supply snapshot worker is running.");
  // Keep process alive
  process.stdin.resume();
}

main().catch((err) => {
  console.error("❌ Worker crashed:", err);
  process.exit(1);
});