import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api/client";

type DexPrice = {
  ok: boolean;
  dex?: string;
  pairAddress?: string | null;
  token?: string;
  priceWbnb?: string | number | null;
  priceUsd?: string | number | null;
  marketCapUsd?: string | number | null;
  updatedAt?: string;
  reason?: string;
};

type LpLock = {
  ok: boolean;
  pairFound?: boolean;
  dex?: string;
  pairAddress?: string | null;
  burn?: { burnedPct?: number };
  warnings?: string[];
  updatedAt?: string;
  reason?: string;
};

type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "missing" } // 404
  | { status: "error"; message: string };

function pillClass(kind: "live" | "next" | "planned" | "warn") {
  if (kind === "live") return "roadmap-pill roadmap-pill--live";
  if (kind === "warn") return "roadmap-pill roadmap-pill--warn";
  if (kind === "next") return "roadmap-pill roadmap-pill--next";
  return "roadmap-pill roadmap-pill--planned";
}

function shortAddr(a?: string | null) {
  if (!a) return "";
  const s = String(a);
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function safeNum(v: any) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function fmtTime(d: Date) {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ✅ investor-grade numeric formatting (no fake $0, no scientific notation)
function fmtCompactNumber(v: any, maxFrac = 8) {
  const n = safeNum(v);
  if (n === null) return "-";
  // avoid scientific notation
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

function fmtUsd(v: any) {
  const n = safeNum(v);
  if (n === null || n <= 0) return "-";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 2 })}`;
}

function fmtPct(v: any) {
  const n = safeNum(v);
  if (n === null || n <= 0) return "-";
  return `${n.toFixed(2)}%`;
}

export function DailyAuditRoadmap(props: {
  systemOnline: boolean;
  indexedBlock: number | null;
  transfers24hCount: number;
  refreshKey?: number;
}) {
  const { systemOnline, indexedBlock, transfers24hCount, refreshKey = 0 } = props;

  const [dex, setDex] = useState<FetchState<DexPrice>>({ status: "idle" });
  const [lp, setLp] = useState<FetchState<LpLock>>({ status: "idle" });
  const [lastChecked, setLastChecked] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function fetchOne<T>(path: string, set: (s: FetchState<T>) => void) {
      try {
        set({ status: "loading" });
        const r = await apiGet<T>(path);
        if (cancelled) return;

        if (!r.ok) {
          if (r.status === 404) return set({ status: "missing" });
          return set({ status: "error", message: r.details ? `${r.error}: ${r.details}` : r.error });
        }
        set({ status: "ok", data: r.data });
      } catch (e: any) {
        if (cancelled) return;
        set({ status: "error", message: e?.message || String(e) });
      }
    }

    setLastChecked(fmtTime(new Date()));

    fetchOne<DexPrice>("/dex/price", setDex);
    fetchOne<LpLock>("/lp/lock", setLp);

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const liveAuditLine = useMemo(() => {
    const parts = [
      systemOnline ? "Health OK (/health)" : "Health failed (/health)",
      indexedBlock !== null ? `Newest indexed: #${indexedBlock.toLocaleString()}` : "Indexer snapshot: -",
      `Transfers (24h): ${transfers24hCount.toLocaleString()} (/transfers/latest)`,
    ];
    return parts.join(" · ");
  }, [systemOnline, indexedBlock, transfers24hCount]);

  // ✅ LIVE Audit pill is strictly based on /health
  const livePill: "live" | "warn" = systemOnline ? "live" : "warn";

  // ✅ Treat ok:false payloads as ISSUE (warn), even if HTTP 200
  const dexOk = dex.status === "ok" && !!dex.data && (dex.data as any).ok === true;
  const lpOk = lp.status === "ok" && !!lp.data && (lp.data as any).ok === true;

  const dexPill: "live" | "next" | "planned" | "warn" =
    dex.status === "missing"
      ? "next"
      : dex.status === "error"
        ? "warn"
        : dex.status === "ok"
          ? dexOk
            ? "live"
            : "warn"
          : "next";

  const lpPill: "live" | "next" | "planned" | "warn" =
    lp.status === "missing"
      ? "next"
      : lp.status === "error"
        ? "warn"
        : lp.status === "ok"
          ? lpOk
            ? "live"
            : "warn"
          : "next";

  // ❌ /security/rules is NOT live -> keep PLANNED always (don’t fetch, don’t break)
  const secPill: "planned" = "planned";

  function openInvestorExplainer() {
    const key = `roadmap_snapshot_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const dexIssue =
      dex.status === "ok" && dex.data && (dex.data as any).ok === false
        ? dex.data.reason || "ok:false"
        : dex.status === "error"
          ? dex.message
          : dex.status;

    const lpIssue =
      lp.status === "ok" && lp.data && (lp.data as any).ok === false
        ? lp.data.reason || "ok:false"
        : lp.status === "error"
          ? lp.message
          : lp.status;

    const snapshot = {
      createdAt: new Date().toISOString(),
      lastCheckedISO: new Date().toISOString(),

      systemOnline,
      indexedBlock,
      transfers24hCount,

      dex: dex.status === "ok" ? dex.data : { reason: dex.status },
      lp: lp.status === "ok" ? lp.data : { reason: lp.status },

      issues: {
        dex: dexPill === "warn" ? dexIssue : null,
        lp: lpPill === "warn" ? lpIssue : null,
        sec: "planned",
      },

      uiHints: {
        dexPill: dexPill === "live" ? "LIVE" : dexPill === "warn" ? "ISSUE" : "NEXT",
        lpPill: lpPill === "live" ? "LIVE" : lpPill === "warn" ? "ISSUE" : "NEXT",
        secPill: "PLANNED",
      },
    };

    try {
      sessionStorage.setItem(key, JSON.stringify(snapshot));
    } catch {}

    const url = `/daily-audit/roadmap-explainer?id=${encodeURIComponent(key)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="audit-roadmap">
      <div className="audit-roadmap-topbar">
        <div className="audit-roadmap-subtle">
          <b>Last checked:</b> {lastChecked || "-"}
        </div>

        <button type="button" className="pill-action-btn" onClick={openInvestorExplainer}>
          Investor Explainer ↗
        </button>
      </div>

      <div className="audit-roadmap-title">Daily Audit Roadmap</div>

      {/* 1) Live Audit */}
      <div className="audit-roadmap-item">
        <div className="audit-roadmap-head">
          <div className="audit-roadmap-bullet" />
          <div className="audit-roadmap-name">Live Audit</div>
          <div className={pillClass(livePill)}>{systemOnline ? "LIVE" : "ISSUE"}</div>
        </div>
        <div className="audit-roadmap-sub">
          Built from live API data: <b>/health</b>, <b>/summary</b>, <b>/top-holders</b>, <b>/transfers/latest</b>
        </div>
        <div className="audit-roadmap-meta">{liveAuditLine}</div>
      </div>

      {/* 2) DEX Pair + Price/MC */}
      <div className="audit-roadmap-item">
        <div className="audit-roadmap-head">
          <div className="audit-roadmap-bullet" />
          <div className="audit-roadmap-name">DEX Pair + Price/MC</div>
          <div className={pillClass(dexPill)}>{dexPill === "live" ? "LIVE" : dexPill === "warn" ? "ISSUE" : "NEXT"}</div>
        </div>

        {dex.status === "ok" ? (
          dex.data.ok === false ? (
            <div className="audit-roadmap-meta">
              <b>/dex/price</b> returned ok:false · {dex.data.reason || "Issue detected"}
            </div>
          ) : (
            <div className="audit-roadmap-meta">
              DEX: {dex.data.dex || "?"} · Pair: {shortAddr(dex.data.pairAddress)} · Token:{" "}
              {shortAddr(dex.data.token || "BC400")} · Price: {fmtCompactNumber(dex.data.priceWbnb, 12)} WBNB
              {dex.data.priceUsd ? ` · ${fmtUsd(dex.data.priceUsd)}` : ""}
              {dex.data.marketCapUsd ? ` · MC: ${fmtUsd(dex.data.marketCapUsd)}` : ""}
            </div>
          )
        ) : dex.status === "missing" ? (
          <div className="audit-roadmap-meta">
            Endpoint not available yet (<b>/dex/price</b>).
          </div>
        ) : dex.status === "error" ? (
          <div className="audit-roadmap-meta">
            Couldn’t load <b>/dex/price</b>: {dex.message}
          </div>
        ) : (
          <div className="audit-roadmap-meta">Checking <b>/dex/price</b>…</div>
        )}
      </div>

      {/* 3) LP Lock Monitor */}
      <div className="audit-roadmap-item">
        <div className="audit-roadmap-head">
          <div className="audit-roadmap-bullet" />
          <div className="audit-roadmap-name">LP Lock Monitor</div>
          <div className={pillClass(lpPill)}>{lpPill === "live" ? "LIVE" : lpPill === "warn" ? "ISSUE" : "NEXT"}</div>
        </div>

        {lp.status === "ok" ? (
          lp.data.ok === false ? (
            <div className="audit-roadmap-meta">
              <b>/lp/lock</b> returned ok:false · {lp.data.reason || "Issue detected"}
            </div>
          ) : (
            <div className="audit-roadmap-meta">
              Pair: {shortAddr(lp.data.pairAddress)} · LP Burned: {fmtPct(lp.data.burn?.burnedPct)}
              {" · "}Locker: not verified
              {lp.data.warnings?.length ? ` · ${lp.data.warnings.join(" | ")}` : ""}
            </div>
          )
        ) : lp.status === "missing" ? (
          <div className="audit-roadmap-meta">
            Endpoint not available yet (<b>/lp/lock</b>).
          </div>
        ) : lp.status === "error" ? (
          <div className="audit-roadmap-meta">
            Couldn’t load <b>/lp/lock</b>: {lp.message}
          </div>
        ) : (
          <div className="audit-roadmap-meta">Checking <b>/lp/lock</b>…</div>
        )}
      </div>

      {/* 4) Security Rules Engine (PLANNED only) */}
      <div className="audit-roadmap-item">
        <div className="audit-roadmap-head">
          <div className="audit-roadmap-bullet" />
          <div className="audit-roadmap-name">Security Rules Engine</div>
          <div className={pillClass(secPill)}>PLANNED</div>
        </div>
        <div className="audit-roadmap-meta">
          Planned advanced analytics (endpoint not enabled yet). This will stay stable and won’t break the UI.
        </div>
      </div>
    </div>
  );
}