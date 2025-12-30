import "dotenv/config";
import { pool } from "../db";
import { insertSupplySnapshot } from "../services/supplySnapshot";

async function main() {
  console.log("[supply-snapshot] starting...");
  const res = await insertSupplySnapshot(pool);

  if (!res.inserted) {
    console.log("[supply-snapshot] skipped:", res.reason);
    console.log("[supply-snapshot] snapshot:", {
      ts: res.snapshot.ts,
      total_supply_raw: res.snapshot.total_supply_raw,
      burned_raw: res.snapshot.burned_raw,
      lp_raw: res.snapshot.lp_raw,
      locked_raw: res.snapshot.locked_raw,
      circulating_raw: res.snapshot.circulating_raw,
      price_usd: res.snapshot.price_usd,
      marketcap_usd: res.snapshot.marketcap_usd,
    });
    process.exit(0);
  }

  console.log("[supply-snapshot] inserted:", {
    ts: res.snapshot.ts,
    total_supply_raw: res.snapshot.total_supply_raw,
    burned_raw: res.snapshot.burned_raw,
    lp_raw: res.snapshot.lp_raw,
    locked_raw: res.snapshot.locked_raw,
    circulating_raw: res.snapshot.circulating_raw,
    price_usd: res.snapshot.price_usd,
    marketcap_usd: res.snapshot.marketcap_usd,
  });

  process.exit(0);
}

main().catch((e) => {
  console.error("[supply-snapshot] failed:", e);
  process.exit(1);
});