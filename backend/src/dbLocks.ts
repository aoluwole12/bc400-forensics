import type { PoolClient } from "pg";

function lockKeyFromString(s: string) {
  // simple stable 32-bit hash
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export async function tryAdvisoryLock(client: PoolClient, name: string) {
  const key = lockKeyFromString(name);
  const res = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [key]);
  return Boolean(res.rows[0]?.ok);
}

export async function advisoryUnlock(client: PoolClient, name: string) {
  const key = lockKeyFromString(name);
  await client.query("SELECT pg_advisory_unlock($1)", [key]);
}