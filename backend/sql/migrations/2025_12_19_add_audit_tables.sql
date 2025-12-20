BEGIN;

-- A) wallet_labels (structured tagging)
CREATE TABLE IF NOT EXISTS public.wallet_labels (
  address_id   integer NOT NULL REFERENCES public.addresses(id) ON DELETE CASCADE,
  label        text    NOT NULL,
  source       text    NOT NULL DEFAULT 'manual',
  confidence   numeric NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (address_id, label)
);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_wallet_labels_label ON public.wallet_labels(label);
CREATE INDEX IF NOT EXISTS idx_wallet_labels_source ON public.wallet_labels(source);

-- Optional: enforce known label values (edit as you grow)
ALTER TABLE public.wallet_labels
  DROP CONSTRAINT IF EXISTS wallet_labels_label_check;

ALTER TABLE public.wallet_labels
  ADD CONSTRAINT wallet_labels_label_check
  CHECK (label IN (
    'burn',
    'lp_pair',
    'lock_contract',
    'vesting_contract',
    'team',
    'treasury',
    'cex',
    'router',
    'marketing',
    'staking_contract',
    'unknown'
  ));

-- Optional: enforce known sources
ALTER TABLE public.wallet_labels
  DROP CONSTRAINT IF EXISTS wallet_labels_source_check;

ALTER TABLE public.wallet_labels
  ADD CONSTRAINT wallet_labels_source_check
  CHECK (source IN ('manual', 'auto', 'import'));


-- B) supply_snapshots (for charts: burned vs circulating, etc.)
CREATE TABLE IF NOT EXISTS public.supply_snapshots (
  ts               timestamptz NOT NULL,
  total_supply_raw numeric NOT NULL,
  burned_raw       numeric NOT NULL DEFAULT 0,
  lp_raw           numeric NOT NULL DEFAULT 0,
  locked_raw       numeric NOT NULL DEFAULT 0,

  -- computed/derived but stored for fast charts
  circulating_raw  numeric NOT NULL DEFAULT 0,

  price_usd        numeric,
  marketcap_usd    numeric,

  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,

  PRIMARY KEY (ts),

  CHECK (total_supply_raw >= 0),
  CHECK (burned_raw >= 0),
  CHECK (lp_raw >= 0),
  CHECK (locked_raw >= 0),
  CHECK (circulating_raw >= 0)
);

CREATE INDEX IF NOT EXISTS idx_supply_snapshots_ts_desc ON public.supply_snapshots(ts DESC);


-- C) concentration_snapshots (effective concentration + risk score over time)
CREATE TABLE IF NOT EXISTS public.concentration_snapshots (
  ts                          timestamptz NOT NULL,

  -- raw (what you show today)
  top10_pct_total             numeric NOT NULL DEFAULT 0 CHECK (top10_pct_total >= 0 AND top10_pct_total <= 100),
  top10_value_total_raw       numeric NOT NULL DEFAULT 0 CHECK (top10_value_total_raw >= 0),

  -- adjusted (true circulating)
  top10_pct_circulating       numeric NOT NULL DEFAULT 0 CHECK (top10_pct_circulating >= 0 AND top10_pct_circulating <= 100),
  top10_value_circulating_raw numeric NOT NULL DEFAULT 0 CHECK (top10_value_circulating_raw >= 0),

  -- the badge number you want
  effective_concentration_pct numeric NOT NULL DEFAULT 0 CHECK (effective_concentration_pct >= 0 AND effective_concentration_pct <= 100),

  -- math-driven score
  risk_score                  integer NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level                  text NOT NULL DEFAULT 'UNKNOWN' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),

  explanation                 text,
  components                  jsonb NOT NULL DEFAULT '{}'::jsonb, -- store breakdown: burn%, lp%, locked%, etc.

  PRIMARY KEY (ts)
);

CREATE INDEX IF NOT EXISTS idx_concentration_snapshots_ts_desc ON public.concentration_snapshots(ts DESC);
CREATE INDEX IF NOT EXISTS idx_concentration_snapshots_risk_level ON public.concentration_snapshots(risk_level);


-- D) Optional but very useful tables

-- D1) lp_events (track liquidity adds/removes if you parse LP logs)
CREATE TABLE IF NOT EXISTS public.lp_events (
  chain_id      integer NOT NULL DEFAULT 56,
  dex           text    NOT NULL DEFAULT 'PancakeSwap',
  pair_address  text    NOT NULL,
  block_number  bigint  NOT NULL,
  block_time    timestamptz,
  tx_hash       text    NOT NULL,
  log_index     integer NOT NULL,

  event_type    text    NOT NULL CHECK (event_type IN ('MINT', 'BURN', 'SYNC', 'SWAP', 'TRANSFER')),
  token0_delta_raw numeric,
  token1_delta_raw numeric,
  lp_delta_raw     numeric,

  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,

  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_lp_events_pair_block ON public.lp_events(pair_address, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_lp_events_time ON public.lp_events(block_time DESC);


-- D2) lock_events (track lock/unlock activity if you integrate PinkLock/UNCX/TeamFinance, etc.)
CREATE TABLE IF NOT EXISTS public.lock_events (
  provider      text    NOT NULL, -- e.g. 'PinkLock', 'UNCX', 'TeamFinance'
  contract_addr text    NOT NULL, -- locker contract
  token_address text    NOT NULL, -- BC400 token contract
  pair_address  text,             -- optional: LP token/pair

  block_number  bigint  NOT NULL,
  block_time    timestamptz,
  tx_hash       text    NOT NULL,
  log_index     integer NOT NULL,

  event_type    text    NOT NULL CHECK (event_type IN ('LOCK', 'UNLOCK', 'EXTEND', 'WITHDRAW')),
  amount_raw    numeric,
  unlock_time   timestamptz,
  owner_address text,

  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,

  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_lock_events_token_block ON public.lock_events(token_address, block_number DESC);
CREATE INDEX IF NOT EXISTS idx_lock_events_unlock_time ON public.lock_events(unlock_time);

COMMIT;
