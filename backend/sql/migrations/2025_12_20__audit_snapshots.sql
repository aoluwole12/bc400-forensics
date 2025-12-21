-- 1) address_labels
CREATE TABLE IF NOT EXISTS public.address_labels (
  address_id  bigint PRIMARY KEY REFERENCES public.addresses(id) ON DELETE CASCADE,
  label       text NOT NULL,
  source      text NOT NULL DEFAULT 'manual',
  confidence  numeric(5,2) NOT NULL DEFAULT 1.00,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_address_labels_label ON public.address_labels(label);

-- 2) audit_snapshots
CREATE TABLE IF NOT EXISTS public.audit_snapshots (
  id                 bigserial PRIMARY KEY,
  snapshot_time      timestamptz NOT NULL DEFAULT now(),
  chain              text NOT NULL DEFAULT 'bsc',
  token_address      text NOT NULL,
  last_indexed_block bigint,
  last_indexed_time  timestamptz,

  total_supply_raw       numeric(78,0),
  burned_raw             numeric(78,0),
  locked_raw             numeric(78,0),
  lp_raw                 numeric(78,0),
  treasury_raw           numeric(78,0),
  circulating_raw        numeric(78,0),

  top10_raw              numeric(78,0),
  top20_raw              numeric(78,0),
  effective_top10_pct    numeric(8,4),
  raw_top10_of_top20_pct numeric(8,4),

  transfers_24h          bigint,
  active_wallets_24h     bigint,
  whale_in_24h_raw       numeric(78,0),
  whale_out_24h_raw      numeric(78,0),
  whale_net_24h_raw      numeric(78,0),

  dex                     text,
  pair_address             text,
  price_usd               numeric(38,18),
  price_wbnb              numeric(38,18),
  reserves_token          numeric(78,0),
  reserves_wbnb           numeric(78,0),
  marketcap_usd           numeric(38,2),

  risk_score              int,
  risk_label              text,
  risk_notes              jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_snapshots_time ON public.audit_snapshots(snapshot_time DESC);
