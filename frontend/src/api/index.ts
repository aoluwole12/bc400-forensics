import { apiGet } from "./client";
import type { DailyAudit, DexTotals } from "./types";

export const api = {
  dailyAudit: () => apiGet<DailyAudit>("/daily-audit"),

  // optional endpoint: safe to call; if missing you’ll get ok:false + status 404
  dexTotals: () => apiGet<DexTotals>("/dex/totals"),
};

export type { DailyAudit, DexTotals };
