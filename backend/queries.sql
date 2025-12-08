psql "$DATABASE_URL" -f queries.sql

-- 1) Total transfers in DB
SELECT COUNT(*) AS total_transfers
FROM transfers;

-- 2) Total unique wallets that ever touched BC400
SELECT COUNT(DISTINCT from_address) + COUNT(DISTINCT to_address) AS approx_unique_wallets
FROM transfers;

-- 3) Unique holders currently in holders table
SELECT COUNT(*) AS total_current_holders
FROM holders;

-- 4) Oldest and newest block/tx timestamps we have
SELECT 
    MIN(block_number) AS first_block,
    MAX(block_number) AS last_block,
    MIN(block_time)   AS first_time,
    MAX(block_time)   AS last_time
FROM transfers;
