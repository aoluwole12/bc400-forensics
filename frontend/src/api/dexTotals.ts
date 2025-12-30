import { apiGet } from "./client";
import type { DexTotals } from "./types";

/** Optional analytics endpoint (pair buy/sell totals). */
export function getDexTotals() {
  return apiGet<DexTotals>("/dex/totals");
}
