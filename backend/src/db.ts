import "dotenv/config";
import { Pool, PoolClient } from "pg";

// Prefer a single DATABASE_URL (works for Render + local)
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://bc400:bc400password@localhost:5432/bc400_forensics";

export const pool = new Pool({
  connectionString,
  // Render Postgres needs SSL
  ssl: connectionString.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

// -------- meta helpers (single source of truth for progress) --------
export async function getMeta(
  key: string,
  client?: PoolClient
): Promise<string | null> {
  const c = client ?? (await pool.connect());
  const releaseAfter = !client;
  try {
    const res = await c.query("SELECT value FROM meta WHERE key = $1", [key]);
    return res.rowCount ? (res.rows[0].value as string) : null;
  } finally {
    if (releaseAfter) c.release();
  }
}

export async function setMeta(
  key: string,
  value: string,
  client?: PoolClient
): Promise<void> {
  const c = client ?? (await pool.connect());
  const releaseAfter = !client;
  try {
    await c.query(
      `
      INSERT INTO meta (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      [key, value]
    );
  } finally {
    if (releaseAfter) c.release();
  }
}

/**
 * Monotonic meta setter (never decreases).
 * Use this for progress pointers like last_indexed_block.
 */
export async function setMetaMax(
  key: string,
  value: string,
  client?: PoolClient
): Promise<void> {
  const c = client ?? (await pool.connect());
  const releaseAfter = !client;
  try {
    await c.query(
      `
      INSERT INTO meta (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key)
      DO UPDATE SET value =
        GREATEST(meta.value::bigint, EXCLUDED.value::bigint)::text
      `,
      [key, value]
    );
  } finally {
    if (releaseAfter) c.release();
  }
}

// -------- address id cache (cuts DB reads a LOT) --------
const addressIdCache = new Map<string, number>();

export async function getOrCreateAddressId(
  address: string,
  client: PoolClient
): Promise<number> {
  const lower = address.toLowerCase();

  const cached = addressIdCache.get(lower);
  if (cached) return cached;

  // 1) try fast select
  const existing = await client.query(
    "SELECT id FROM addresses WHERE address = $1",
    [lower]
  );
  if (existing.rowCount) {
    const id = existing.rows[0].id as number;
    addressIdCache.set(lower, id);
    return id;
  }

  // 2) insert (safe if another worker inserts same address)
  const inserted = await client.query(
    `
    INSERT INTO addresses (address)
    VALUES ($1)
    ON CONFLICT (address) DO NOTHING
    RETURNING id
    `,
    [lower]
  );

  if (inserted.rowCount) {
    const id = inserted.rows[0].id as number;
    addressIdCache.set(lower, id);
    return id;
  }

  // 3) someone else inserted; select again
  const again = await client.query(
    "SELECT id FROM addresses WHERE address = $1",
    [lower]
  );
  if (!again.rowCount)
    throw new Error("Failed to getOrCreateAddressId for " + lower);

  const id = again.rows[0].id as number;
  addressIdCache.set(lower, id);
  return id;
}

/**
 * Backwards-compat wrapper (so older code doesn’t crash).
 * - if passed a PoolClient -> use it
 * - otherwise it creates its own client (slower, but safe)
 */
export async function getOrCreateAddress(
  address: string,
  clientOrSomething?: PoolClient | bigint
): Promise<number> {
  if (clientOrSomething && typeof (clientOrSomething as any).query === "function") {
    return getOrCreateAddressId(address, clientOrSomething as PoolClient);
  }

  const c = await pool.connect();
  try {
    return await getOrCreateAddressId(address, c);
  } finally {
    c.release();
  }
}