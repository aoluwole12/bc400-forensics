BEGIN;

TRUNCATE holder_balances;

INSERT INTO holder_balances (
  address_id,
  balance_raw,
  balance_bc400,
  tx_count,
  tags,
  first_seen,
  last_seen,
  last_tx_hash,
  last_block_number,
  last_block_time
)
SELECT
  a.id AS address_id,

  -- raw token units
  SUM(
    CASE WHEN t.to_address_id = a.id THEN t.raw_amount::numeric ELSE 0::numeric END
  )
  -
  SUM(
    CASE WHEN t.from_address_id = a.id THEN t.raw_amount::numeric ELSE 0::numeric END
  ) AS balance_raw,

  -- BC400 units (assuming 9 decimals)
  (
    SUM(
      CASE WHEN t.to_address_id = a.id THEN t.raw_amount::numeric ELSE 0::numeric END
    )
    -
    SUM(
      CASE WHEN t.from_address_id = a.id THEN t.raw_amount::numeric ELSE 0::numeric END
    )
  ) / 1e9::numeric AS balance_bc400,

  COUNT(*) AS tx_count,
  'none' AS tags,

  MIN(t.block_time) AS first_seen,
  MAX(t.block_time) AS last_seen,

  -- last tx hash
  (
    SELECT t2.tx_hash
    FROM transfers t2
    WHERE t2.to_address_id = a.id OR t2.from_address_id = a.id
    ORDER BY t2.block_number DESC, t2.log_index DESC
    LIMIT 1
  ) AS last_tx_hash,

  -- last block number
  (
    SELECT t2.block_number
    FROM transfers t2
    WHERE t2.to_address_id = a.id OR t2.from_address_id = a.id
    ORDER BY t2.block_number DESC, t2.log_index DESC
    LIMIT 1
  ) AS last_block_number,

  -- last block time
  (
    SELECT t2.block_time
    FROM transfers t2
    WHERE t2.to_address_id = a.id OR t2.from_address_id = a.id
    ORDER BY t2.block_number DESC, t2.log_index DESC
    LIMIT 1
  ) AS last_block_time

FROM addresses a
JOIN transfers t
  ON t.to_address_id = a.id OR t.from_address_id = a.id
GROUP BY a.id
HAVING
  (
    SUM(
      CASE WHEN t.to_address_id = a.id THEN t.raw_amount::numeric ELSE 0::numeric END
    )
    -
    SUM(
      CASE WHEN t.from_address_id = a.id THEN t.raw_amount::numeric ELSE 0::numeric END
    )
  ) > 0
ORDER BY balance_raw DESC;

COMMIT;