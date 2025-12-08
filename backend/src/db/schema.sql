-- Addresses we see in BC400 transfers
CREATE TABLE IF NOT EXISTS addresses (
  id               SERIAL PRIMARY KEY,
  address          TEXT UNIQUE NOT NULL,
  label            TEXT,
  cluster_id       INTEGER,
  first_seen_block BIGINT,
  last_seen_block  BIGINT
);

-- Every BC400 transfer we index
CREATE TABLE IF NOT EXISTS transfers (
  id              BIGSERIAL PRIMARY KEY,
  tx_hash         TEXT NOT NULL,
  log_index       INTEGER NOT NULL,
  block_number    BIGINT NOT NULL,
  timestamp       TIMESTAMPTZ,
  from_address_id INTEGER REFERENCES addresses(id),
  to_address_id   INTEGER REFERENCES addresses(id),
  amount_raw      NUMERIC(78, 0),      -- value in raw units
  amount          NUMERIC(38, 18)      -- human-readable
);

-- Helpful indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_transfers_block_number
  ON transfers(block_number);

CREATE INDEX IF NOT EXISTS idx_transfers_tx_hash
  ON transfers(tx_hash);

CREATE INDEX IF NOT EXISTS idx_transfers_from_address_id
  ON transfers(from_address_id);

CREATE INDEX IF NOT EXISTS idx_transfers_to_address_id
  ON transfers(to_address_id);