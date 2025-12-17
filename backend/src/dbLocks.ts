import type { PoolClient } from "pg";

/**
 * Stable 64-bit hash -> bigint (as string-safe JS BigInt)
 * Very low collision risk compared to 32-bit.
 */
function lockKey64(name: string): bigint {
  // FNV-1a 64-bit
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < name.length; i++) {
    h ^= BigInt(name.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn; // keep 64-bit
  }
  // Postgres bigint is signed; convert to signed range if needed
  if (h > 0x7fffffffffffffffn) h = h - 0x10000000000000000n;
  return h;
}

export async function tryAdvisoryLock(client: PoolClient, name: string): Promise<boolean> {
  const key = lockKey64(name).toString(); // pg will cast text -> bigint fine
  const res = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS ok", [key]);
  return Boolean(res.rows[0]?.ok);
}

export async function advisoryUnlock(client: PoolClient, name: string): Promise<void> {
  const key = lockKey64(name).toString();
  await client.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
}