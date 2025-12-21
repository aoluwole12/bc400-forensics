import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

type DexPrice = {
  ok: boolean;
  dex?: string;
  pairAddress?: string;
  token?: string;
  priceWbnb?: string | number;
  priceUsd?: string | number;
  marketCapUsd?: string | number;
  updatedAt?: string;
  reason?: string;
};

type LpLock = {
  ok: boolean;
  pairFound?: boolean;
  dex?: string;
  pairAddress?: string;
  burn?: { burnedPct?: number };
  updatedAt?: string;
  reason?: string;
};

type SecurityRules = {
  ok?: boolean;
  version?: string;
  transfers24h?: number;
  newestIndexedBlock?: number;
  updatedAt?: string;
  reason?: string;
};

type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "missing" } // 404 or not implemented
  | { status: "error"; message: string };

function pillClass(kind: "live" | "next" | "planned" | "warn") {
  if (kind === "live") return "roadmap-pill roadmap-pill--live";
  if (kind === "warn") return "roadmap-pill roadmap-pill--warn";
  if (kind === "next") return "roadmap-pill roadmap-pill--next";
  return "roadmap-pill roadmap-pill--planned";
}

function shortAddr(a?: string) {
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

export function DailyAuditRoadmap(props: {
  systemOnline: boolean;
  indexedBlock: number | null;
  transfers24hCount: number;
}) {
  const { systemOnline, indexedBlock, transfers24hCount } = props;

  const [dex, setDex] = useState<FetchState<DexPrice>>({ status: "idle" });
  const [lp, setLp] = useState<FetchState<LpLock>>({ status: "idle" });
  const [sec, setSec] = useState<FetchState<SecurityRules>>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;

    async function fetchOne<T>(
      path: string,
      set: (s: FetchState<T>) => void
    ) {
      try {
        set({ status: "loading" });
        const res = await fetch(`${API_BASE}${path}`);
        if (cancelled) return;

        if (res.status === 404) {
          set({ status: "missing" });
          return;
        }
        if (!res.ok) {
          set({ status: "error", message: `HTTP ${res.status}` });
          return;
        }
        const data = (await res.json()) as T;
        set({ status: "ok", data });
      } catch (e: any) {
        if (cancelled) return;
        set({ status: "error", message: e?.message || String(e) });
      }
    }

    // These are “optional live” — if not implemented, they show NEXT/PLANNED
    fetchOne<DexPrice>("/dex/price", setDex);
    fetchOne<LpLock>("/lp/lock", setLp);
    fetchOne<SecurityRules>("/security/rules", setSec);

    return () => {
      cancelled = true;
    };
  }, []);

  const liveAuditLine = useMemo(() => {
    const parts = [
      systemOnline ? "Health OK (/health)" : "Health failed (/health)",
      indexedBlock !== null ? `Newest indexed: #${indexedBlock.toLocaleString()}` : "Indexer snapshot: -",
      `Transfers (24h): ${transfers24hCount.toLocaleString()} (/transfers/latest)`,
    ];
    return parts.join(" · ");
  }, [systemOnline, indexedBlock, transfers24hCount]);

  // Determine “status pills”
  const livePill = systemOnline ? "live" : "warn";

  const dexPill: "live" | "next" | "planned" | "warn" =
    dex.status === "ok"
      ? "live"
      : dex.status === "missing"
        ? "next"
        : dex.status === "error"
          ? "warn"
          : "next";

  const lpPill: "live" | "next" | "planned" | "warn" =
    lp.status === "ok"
      ? "live"
      : lp.status === "missing"
        ? "next"
        : lp.status === "error"
          ? "warn"
          : "next";

  const secPill: "live" | "next" | "planned" | "warn" =
    sec.status === "ok"
      ? "live"
      : sec.status === "missing"
        ? "planned"
        : sec.status === "error"
          ? "warn"
          : "planned";

  return (
    <div className="audit-roadmap">
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
          <div className={pillClass(dexPill)}>
            {dexPill === "live" ? "LIVE" : dexPill === "warn" ? "ISSUE" : "NEXT"}
          </div>
        </div>

        {dex.status === "ok" ? (
          <div className="audit-roadmap-meta">
            DEX: {dex.data.dex || "?"} · Pair: {shortAddr(dex.data.pairAddress)} · Token:{" "}
            {dex.data.token || "BC400"} · Price:{" "}
            {dex.data.priceWbnb ?? "-"} WBNB
            {dex.data.priceUsd ? ` · ~$${dex.data.priceUsd}` : ""}
            {dex.data.marketCapUsd ? ` · MC: ~$${dex.data.marketCapUsd}` : ""}
          </div>
        ) : dex.status === "missing" ? (
          <div className="audit-roadmap-meta">
            Endpoint not available yet (<b>/dex/price</b>). When added, this line becomes live.
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
          <div className={pillClass(lpPill)}>
            {lpPill === "live" ? "LIVE" : lpPill === "warn" ? "ISSUE" : "NEXT"}
          </div>
        </div>

        {lp.status === "ok" ? (
          <div className="audit-roadmap-meta">
            Pair: {shortAddr(lp.data.pairAddress)} · LP Burned:{" "}
            {safeNum(lp.data.burn?.burnedPct) !== null
              ? `${Number(lp.data.burn?.burnedPct).toFixed(2)}%`
              : "-"}
            {" · "}Locker: not verified
          </div>
        ) : lp.status === "missing" ? (
          <div className="audit-roadmap-meta">
            Endpoint not available yet (<b>/lp/lock</b>). When added, this line becomes live.
          </div>
        ) : lp.status === "error" ? (
          <div className="audit-roadmap-meta">
            Couldn’t load <b>/lp/lock</b>: {lp.message}
          </div>
        ) : (
          <div className="audit-roadmap-meta">Checking <b>/lp/lock</b>…</div>
        )}
      </div>

      {/* 4) Security Rules Engine */}
      <div className="audit-roadmap-item">
        <div className="audit-roadmap-head">
          <div className="audit-roadmap-bullet" />
          <div className="audit-roadmap-name">Security Rules Engine</div>
          <div className={pillClass(secPill)}>
            {secPill === "live" ? "LIVE" : secPill === "warn" ? "ISSUE" : "PLANNED"}
          </div>
        </div>

        {sec.status === "ok" ? (
          <div className="audit-roadmap-meta">
            {sec.data.version ? `${sec.data.version} · ` : ""}
            Transfers (24h):{" "}
            {typeof sec.data.transfers24h === "number" ? sec.data.transfers24h.toLocaleString() : "-"}
            {" · "}Newest indexed:{" "}
            {typeof sec.data.newestIndexedBlock === "number"
              ? `#${sec.data.newestIndexedBlock.toLocaleString()}`
              : indexedBlock !== null
                ? `#${indexedBlock.toLocaleString()}`
                : "-"}
          </div>
        ) : sec.status === "missing" ? (
          <div className="audit-roadmap-meta">
            Planned advanced analytics (<b>/security/rules</b> not live yet).
          </div>
        ) : sec.status === "error" ? (
          <div className="audit-roadmap-meta">
            Couldn’t load <b>/security/rules</b>: {sec.message}
          </div>
        ) : (
          <div className="audit-roadmap-meta">Checking <b>/security/rules</b>…</div>
        )}
      </div>
    </div>
  );
}