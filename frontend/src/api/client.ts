const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; error: string; details?: string };

async function tryFetch(url: string) {
  try {
    const res = await fetch(url);
    return res;
  } catch (e: any) {
    throw new Error(e?.message || String(e));
  }
}

/**
 * Fetch helper that supports both:
 *   /daily-audit
 *   /api/daily-audit
 * (same for other endpoints)
 */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const base = API_BASE.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;

  // try direct first
  let res = await tryFetch(`${base}${p}`);
  if (res.status === 404) {
    // try /api alias
    res = await tryFetch(`${base}/api${p}`);
  }

  const status = res.status;

  if (!res.ok) {
    let details = "";
    try {
      const j = await res.json();
      details = j?.details || j?.detail || j?.error || "";
    } catch {}
    return {
      ok: false,
      status,
      error: `HTTP ${status}`,
      details: details ? String(details) : undefined,
    };
  }

  const data = (await res.json()) as T;
  return { ok: true, data, status };
}
