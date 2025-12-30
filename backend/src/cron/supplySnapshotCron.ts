import type { Pool } from "pg";
import { insertSupplySnapshot } from "../services/supplySnapshot";

/**
 * Starts a simple interval job.
 * Enable by setting ENABLE_SUPPLY_SNAPSHOT_CRON=true
 * Interval minutes default: 15
 */
export function startSupplySnapshotCron(pool: Pool) {
  const enabled =
    String(process.env.ENABLE_SUPPLY_SNAPSHOT_CRON || "").toLowerCase() === "true";

  if (!enabled) {
    console.log("[supply-cron] disabled (set ENABLE_SUPPLY_SNAPSHOT_CRON=true to enable)");
    return;
  }

  const mins = Number(process.env.SUPPLY_SNAPSHOT_INTERVAL_MINUTES || "15");
  const ms = Math.max(1, mins) * 60 * 1000;

  console.log(`[supply-cron] enabled. interval=${mins} minutes`);

  async function runOnce(label: "initial" | "interval") {
    try {
      const res = await insertSupplySnapshot(pool);
      const ts = res.snapshot.ts.toISOString();

      if (!res.inserted) {
        console.log(`[supply-cron] ${label} skip ts=${ts} reason=${res.reason ?? "unknown"}`);
        return;
      }

      console.log(`[supply-cron] ${label} inserted ts=${ts}`);
    } catch (e) {
      console.error(`[supply-cron] ${label} run failed:`, e);
    }
  }

  // run once on boot (after a short delay)
  setTimeout(() => void runOnce("initial"), 3000);

  // run every interval
  setInterval(() => void runOnce("interval"), ms);
}