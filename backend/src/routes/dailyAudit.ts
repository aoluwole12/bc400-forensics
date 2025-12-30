import type { Express } from "express";
import type { Pool } from "pg";

// ✅ NEW: live risk calculator (backend file)
import { computeRiskFromDailyAudit } from "../analytics/risk";

export function registerDailyAuditRoute(app: Express, pool: Pool) {
  const handler = async (_req: any, res: any) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ✅ IMPORTANT: set_config must run on the same connection as the SQL
      await client.query(`SELECT set_config('app.bc400_pair', $1, true)`, [
        process.env.BC400_PAIR_ADDRESS || "",
      ]);
      await client.query(`SELECT set_config('app.bc400_treasury', $1, true)`, [
        process.env.BC400_TREASURY_WALLET || "",
      ]);
      await client.query(`SELECT set_config('app.bc400_devburn', $1, true)`, [
        process.env.BC400_DEV_BURN_WALLET || "",
      ]);

      const sql = `
WITH
one_row AS (SELECT 1 AS one),

latest_supply AS (
  SELECT
    ts,
    total_supply_raw,
    burned_raw,
    lp_raw,
    locked_raw,
    circulating_raw,
    price_usd,
    marketcap_usd AS fdv_usd,
    metadata,

    COALESCE(NULLIF((metadata->>'decimals')::int, 0), 18) AS decimals,

    -- ✅ normalize circulating into raw units if it looks human-sized
    CASE
      WHEN circulating_raw IS NULL THEN NULL
      WHEN circulating_raw < 1000000000000000000 THEN
        (circulating_raw::numeric * (10::numeric ^ COALESCE(NULLIF((metadata->>'decimals')::int, 0), 18)))
      ELSE
        circulating_raw::numeric
    END AS circulating_raw_norm,

    CASE
      WHEN circulating_raw IS NULL THEN NULL
      ELSE (circulating_raw::numeric / (10::numeric ^ COALESCE(NULLIF((metadata->>'decimals')::int, 0), 18)))
    END AS circulating_supply,

    CASE
      WHEN total_supply_raw IS NULL THEN NULL
      ELSE (total_supply_raw::numeric / (10::numeric ^ COALESCE(NULLIF((metadata->>'decimals')::int, 0), 18)))
    END AS total_supply,

    CASE
      WHEN price_usd IS NULL OR price_usd <= 0 THEN NULL
      WHEN circulating_raw IS NULL OR circulating_raw <= 0 THEN NULL
      ELSE price_usd * (circulating_raw::numeric / (10::numeric ^ COALESCE(NULLIF((metadata->>'decimals')::int, 0), 18)))
    END AS marketcap_circulating_usd

  FROM public.supply_snapshots
  ORDER BY ts DESC
  LIMIT 1
),

last_chain AS (
  SELECT
    MAX(block_number) AS last_indexed_block,
    MAX(block_time)   AS last_indexed_time
  FROM public.transfers
),

transfer_window AS (
  SELECT
    NOW() AS now_ts,
    NOW() - INTERVAL '24 hours' AS window_start,

    COUNT(*) FILTER (WHERE t.block_time >= NOW() - INTERVAL '24 hours') AS txs_24h,
    COUNT(*) FILTER (WHERE t.block_time >= NOW() - INTERVAL '6 hours')  AS txs_6h,
    COUNT(*) FILTER (WHERE t.block_time >= NOW() - INTERVAL '1 hour')   AS txs_1h,

    (
      SELECT COUNT(DISTINCT x.addr_id)
      FROM (
        SELECT from_address_id AS addr_id
        FROM public.transfers
        WHERE block_time >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT to_address_id AS addr_id
        FROM public.transfers
        WHERE block_time >= NOW() - INTERVAL '24 hours'
      ) x
      WHERE x.addr_id IS NOT NULL
    ) AS active_wallets_24h
  FROM public.transfers t
),

top10 AS (
  SELECT
    COALESCE(SUM(balance_raw), 0)   AS top10_raw,
    COALESCE(SUM(balance_bc400), 0) AS top10_bc400
  FROM (
    SELECT balance_raw, balance_bc400
    FROM public.holder_balances
    ORDER BY balance_raw DESC NULLS LAST
    LIMIT 10
  ) h
),

supply_flags AS (
  SELECT
    CASE WHEN ls.ts IS NULL THEN TRUE ELSE FALSE END AS supply_missing,
    CASE
      WHEN ls.ts IS NULL THEN FALSE
      WHEN COALESCE(ls.total_supply_raw,0)=0
       AND COALESCE(ls.burned_raw,0)=0
       AND COALESCE(ls.lp_raw,0)=0
       AND COALESCE(ls.locked_raw,0)=0
       AND COALESCE(ls.circulating_raw,0)=0
      THEN TRUE
      ELSE FALSE
    END AS supply_all_zero,
    CASE
      WHEN ls.ts IS NULL THEN FALSE
      WHEN COALESCE(ls.total_supply_raw,0) > 0
       AND COALESCE(ls.circulating_raw,0) = 0
      THEN TRUE
      ELSE FALSE
    END AS supply_inconsistent
  FROM one_row r
  LEFT JOIN latest_supply ls ON TRUE
),

excluded_addrs AS (
  SELECT LOWER(x.addr) AS addr
  FROM (VALUES
    ('0x0000000000000000000000000000000000000000'),
    ('0x000000000000000000000000000000000000dead'),
    (LOWER(COALESCE(current_setting('app.bc400_pair', true), ''))),
    (LOWER(COALESCE(current_setting('app.bc400_treasury', true), ''))),
    (LOWER(COALESCE(current_setting('app.bc400_devburn', true), '')))
  ) x(addr)
  WHERE x.addr ~ '^0x[0-9a-f]{40}$'
),

excluded_ids AS (
  SELECT a.id, a.address
  FROM public.addresses a
  JOIN excluded_addrs e ON LOWER(a.address) = e.addr
),

excluded_balance AS (
  SELECT COALESCE(SUM(hb.balance_raw::numeric), 0) AS excluded_raw
  FROM public.holder_balances hb
  JOIN excluded_ids e ON e.id = hb.address_id
),

true_circulating AS (
  SELECT
    GREATEST(
      COALESCE(ls.circulating_raw_norm, 0) - (SELECT excluded_raw FROM excluded_balance),
      0
    ) AS true_circulating_raw
  FROM latest_supply ls
),

top10_true AS (
  SELECT COALESCE(SUM(hb.balance_raw::numeric), 0) AS top10_true_raw
  FROM (
    SELECT hb.balance_raw
    FROM public.holder_balances hb
    JOIN public.addresses a ON a.id = hb.address_id
    LEFT JOIN excluded_addrs e ON LOWER(a.address) = e.addr
    WHERE e.addr IS NULL
    ORDER BY hb.balance_raw DESC NULLS LAST
    LIMIT 10
  ) hb
),

top20_true AS (
  SELECT hb.balance_raw::numeric AS balance_raw
  FROM public.holder_balances hb
  JOIN public.addresses a ON a.id = hb.address_id
  LEFT JOIN excluded_addrs e ON LOWER(a.address) = e.addr
  WHERE e.addr IS NULL
  ORDER BY hb.balance_raw DESC NULLS LAST
  LIMIT 20
),

adjusted_metrics AS (
  SELECT
    (SELECT true_circulating_raw FROM true_circulating) AS true_circulating_raw,

    CASE
      WHEN (SELECT true_circulating_raw FROM true_circulating) = 0 THEN NULL
      ELSE ((SELECT top10_true_raw FROM top10_true) / (SELECT true_circulating_raw FROM true_circulating)) * 100
    END AS top10_pct_true_circulating,

    CASE
      WHEN (SELECT true_circulating_raw FROM true_circulating) = 0 THEN NULL
      ELSE (
        SELECT SUM(POWER((t.balance_raw / (SELECT true_circulating_raw FROM true_circulating)), 2))
        FROM top20_true t
      )
    END AS hhi_true
),

adjusted_effective AS (
  SELECT
    true_circulating_raw,
    top10_pct_true_circulating,
    hhi_true,
    CASE WHEN hhi_true IS NULL OR hhi_true = 0 THEN NULL ELSE (1 / hhi_true) END AS effective_holders_true,
    CASE WHEN hhi_true IS NULL THEN NULL ELSE (hhi_true * 100) END AS effective_concentration_pct_true
  FROM adjusted_metrics
),

recent_transfers AS (
  SELECT
    t.block_number,
    t.block_time,
    t.tx_hash,
    t.log_index,
    fa.address AS from_address,
    ta.address AS to_address,
    t.raw_amount
  FROM public.transfers t
  LEFT JOIN public.addresses fa ON fa.id = t.from_address_id
  LEFT JOIN public.addresses ta ON ta.id = t.to_address_id
  ORDER BY t.block_number DESC, t.log_index DESC
  LIMIT 25
)

SELECT jsonb_build_object(
  'generatedAt', NOW(),

  'window', jsonb_build_object(
    'label', 'last 24h',
    'start', (SELECT window_start FROM transfer_window),
    'end',   (SELECT now_ts FROM transfer_window)
  ),

  'chain', jsonb_build_object(
    'lastIndexedBlock', (SELECT last_indexed_block FROM last_chain),
    'lastIndexedTime',  (SELECT last_indexed_time  FROM last_chain)
  ),

  'transfers', jsonb_build_object(
    'txs24h', (SELECT txs_24h FROM transfer_window),
    'txs6h',  (SELECT txs_6h  FROM transfer_window),
    'txs1h',  (SELECT txs_1h  FROM transfer_window),
    'activeWallets24h', (SELECT active_wallets_24h FROM transfer_window),
    'recent', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'blockNumber', block_number,
            'blockTime',   block_time,
            'txHash',      tx_hash,
            'logIndex',    log_index,
            'from',        from_address,
            'to',          to_address,
            'rawAmount',   raw_amount
          )
        ),
        '[]'::jsonb
      )
      FROM recent_transfers
    )
  ),

  'supply', jsonb_build_object(
    'snapshotTime',     (SELECT ts FROM latest_supply),
    'totalSupplyRaw',   (SELECT total_supply_raw FROM latest_supply),
    'burnedRaw',        (SELECT burned_raw      FROM latest_supply),
    'lpRaw',            (SELECT lp_raw          FROM latest_supply),
    'lockedRaw',        (SELECT locked_raw      FROM latest_supply),
    'circulatingRaw',   (SELECT circulating_raw FROM latest_supply),
    'decimals',         (SELECT decimals FROM latest_supply),
    'totalSupply',      (SELECT total_supply FROM latest_supply),
    'circulatingSupply',(SELECT circulating_supply FROM latest_supply),
    'priceUsd',         (SELECT price_usd FROM latest_supply),
    'marketCapUsd',     (SELECT marketcap_circulating_usd FROM latest_supply),
    'fdvUsd',           (SELECT fdv_usd FROM latest_supply),
    'marketcapUsdLegacy',(SELECT fdv_usd FROM latest_supply),
    'metadata',         (SELECT metadata FROM latest_supply),
    'flags', jsonb_build_object(
      'missing',      (SELECT supply_missing      FROM supply_flags),
      'allZero',      (SELECT supply_all_zero     FROM supply_flags),
      'inconsistent', (SELECT supply_inconsistent FROM supply_flags)
    )
  ),

  'holders', jsonb_build_object(
    'top10', jsonb_build_object(
      'sumRaw',   (SELECT top10_raw   FROM top10),
      'sumBc400', (SELECT top10_bc400 FROM top10)
    )
  ),

  'concentrationAdjusted', jsonb_build_object(
    'ok', (
      (SELECT NOT supply_missing FROM supply_flags)
      AND (SELECT NOT supply_inconsistent FROM supply_flags)
      AND (SELECT true_circulating_raw FROM adjusted_effective) > 0
    ),
    'circulatingRawNorm', (SELECT COALESCE(circulating_raw_norm, 0)::text FROM latest_supply),
    'excluded', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('address', address)), '[]'::jsonb)
      FROM excluded_ids
    ),
    'excludedBalanceRaw', (SELECT excluded_raw::text FROM excluded_balance),
    'trueCirculatingRaw', (SELECT true_circulating_raw::text FROM adjusted_effective),
    'top10PctOfTrueCirculating', (SELECT top10_pct_true_circulating FROM adjusted_effective),
    'effectiveConcentrationPct', (SELECT effective_concentration_pct_true FROM adjusted_effective),
    'effectiveHolders', (SELECT effective_holders_true FROM adjusted_effective)
  )

  -- ✅ NOTE: We REMOVED the SQL-built risk object on purpose.
  -- Risk is now computed in Node from the returned bundle.
) AS daily_audit_json;
`;

      const { rows } = await client.query(sql);

      await client.query("COMMIT");

      const daily = rows?.[0]?.daily_audit_json ?? {};

      // ✅ compute risk LIVE from the bundle you just produced
      const risk = computeRiskFromDailyAudit(daily);

      // ✅ inject into bundle (same shape your frontend expects)
      daily.risk = { latest: risk };

      return res.json(daily);
    } catch (err: any) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      console.error("GET /daily-audit failed:", err);
      return res.status(500).json({
        error: "daily_audit_failed",
        detail: String(err?.message ?? err),
      });
    } finally {
      client.release();
    }
  };

  app.get("/daily-audit", handler);
  app.get("/api/daily-audit", handler);
}