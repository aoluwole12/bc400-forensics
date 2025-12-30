import type { Express } from "express";
import type { Pool } from "pg";

function addrOrEmpty(v?: string) {
  const val = (v ?? "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(val) ? val : "";
}

function mustAddr(label: string, v?: string) {
  const val = (v ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(val)) throw new Error(`Missing/invalid ${label}: "${val}"`);
  return val;
}

function toBigIntSafe(input: any): bigint {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!s) return 0n;
  if (!/^-?\d+$/.test(s)) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

// stable ratio without bigint->Number overflow
function scaledRatio(numer: bigint, denom: bigint): number | null {
  if (denom <= 0n) return null;
  const a = numer.toString();
  const b = denom.toString();
  const keep = 15;
  const an = a.length > keep ? Number(a.slice(0, keep)) : Number(a);
  const bn = b.length > keep ? Number(b.slice(0, keep)) : Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn) || bn <= 0) return null;
  const exp = (a.length - Math.min(a.length, keep)) - (b.length - Math.min(b.length, keep));
  return (an / bn) * Math.pow(10, exp);
}

export function registerInvestorAdjustedRoute(app: Express, pool: Pool) {
  async function handler(_req: any, res: any) {
    try {
      const token = mustAddr("BC400_TOKEN_ADDRESS", process.env.BC400_TOKEN_ADDRESS);

      // addresses to exclude from "true circulating" concentration calcs
      const pair = addrOrEmpty(process.env.BC400_PAIR_ADDRESS);
      const treasury = addrOrEmpty(process.env.BC400_TREASURY_WALLET);
      const devburn = addrOrEmpty(process.env.BC400_DEV_BURN_WALLET);
      const locked = addrOrEmpty(process.env.BC400_LOCKED_ADDRESS);

      const burnDead = "0x000000000000000000000000000000000000dEaD";
      const zeroAddr = "0x0000000000000000000000000000000000000000";

      const excluded = [
        burnDead,
        zeroAddr,
        pair,
        treasury,
        devburn,
        locked,
      ]
        .map((x) => (x ? x.toLowerCase() : ""))
        .filter(Boolean);

      // get latest supply snapshot (this is your “adjusted/true circulating” source of truth)
      const snapQ = await pool.query<{
        ts: string;
        circulating_raw: string;
        burned_raw: string;
        lp_raw: string;
        locked_raw: string;
      }>(
        `
        SELECT ts, circulating_raw, burned_raw, lp_raw, locked_raw
        FROM public.supply_snapshots
        WHERE token_address = $1
        ORDER BY ts DESC
        LIMIT 1
        `,
        [token]
      );

      if (snapQ.rowCount === 0) {
        return res.json({
          ok: false,
          reason: "No supply snapshots yet (run snapshot:supply or enable cron on Render).",
          updatedAt: new Date().toISOString(),
        });
      }

      const snap = snapQ.rows[0];
      const trueCirculatingRaw = toBigIntSafe(snap.circulating_raw);

      if (trueCirculatingRaw <= 0n) {
        return res.json({
          ok: false,
          reason: "Latest snapshot has circulating_raw <= 0 (check burn/devburn overlap).",
          trueCirculatingRaw: snap.circulating_raw,
          updatedAt: new Date().toISOString(),
        });
      }

      // pull top 20 holders excluding burn/LP/treasury/etc
      // NOTE: hb.balance_raw is stored as text; cast to numeric for sorting
      const topQ = await pool.query<{
        address: string;
        balance_raw: string;
      }>(
        `
        SELECT a.address, hb.balance_raw
        FROM holder_balances hb
        JOIN addresses a ON a.id = hb.address_id
        WHERE hb.balance_raw::numeric > 0
          AND LOWER(a.address) <> ALL($1::text[])
        ORDER BY hb.balance_raw::numeric DESC
        LIMIT 20
        `,
        [excluded]
      );

      const rows = topQ.rows.map((r) => ({
        address: r.address,
        bal: toBigIntSafe(r.balance_raw),
      }));

      const top10 = rows.slice(0, 10);
      const top20 = rows.slice(0, 20);

      const top10Sum = top10.reduce((acc, x) => acc + x.bal, 0n);

      // Top10% of True Circulating
      const top10Pct =
        trueCirculatingRaw > 0n
          ? Number((top10Sum * 1000000n) / trueCirculatingRaw) / 10000 // 2dp
          : null;

      // Effective concentration (HHI on top20 shares of true circulating)
      let hhi = 0;
      for (const h of top20) {
        const share = scaledRatio(h.bal, trueCirculatingRaw);
        if (share === null || !Number.isFinite(share) || share <= 0) continue;
        hhi += share * share;
      }

      const effectiveConcentrationPct = hhi > 0 ? hhi * 100 : null;
      const effectiveHolders = hhi > 0 ? 1 / hhi : null;

      return res.json({
        ok: true,
        trueCirculatingRaw: trueCirculatingRaw.toString(),
        top10PctOfTrueCirculating: top10Pct,
        effectiveConcentrationPct,
        effectiveHolders,
        excluded: {
          burnedRaw: snap.burned_raw,
          lpRaw: snap.lp_raw,
          lockedRaw: snap.locked_raw,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[investor-adjusted] error:", e);
      return res.status(500).json({
        ok: false,
        reason: e?.message || String(e),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  app.get("/investor/adjusted", handler);
  app.get("/api/investor/adjusted", handler);
}