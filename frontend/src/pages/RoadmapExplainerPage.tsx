import { useMemo } from "react";
import "../index.css";
import { Header } from "../components/Header";
import DailyAuditLayout from "../components/daily-audit/DailyAuditLayout";

function getParam(name: string) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function niceTime(iso?: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

type Pill = "LIVE" | "NEXT" | "PLANNED" | "ISSUE";

function explainerForStatus(title: string, status: any, pill: Pill) {
  const base = {
    title,
    pill,
    whatItMeans: "",
    whyInvestorsCare: "",
    howToRead: "",
    riskNotes: "",
  };

  // Helper: build a “live” narrative from raw values
  const liveDetails = (() => {
    if (!status) return "";

    if (title === "Live Audit") {
      const health = status.health ?? "-";
      const newest = status.newestIndexed ?? "-";
      const t24 = status.transfers24h ?? "-";
      return `Current snapshot: Health=${health}, Newest indexed block=${newest}, Transfers(24h)=${t24}.`;
    }

    if (title.startsWith("DEX")) {
      const dex = status?.dex || status?.data?.dex;
      const pair = status?.pairAddress || status?.data?.pairAddress;
      const priceWbnb = status?.priceWbnb ?? status?.data?.priceWbnb;
      const priceUsd = status?.priceUsd ?? status?.data?.priceUsd;
      const mc = status?.marketCapUsd ?? status?.data?.marketCapUsd;
      return `Live DEX feed: DEX=${dex || "?"}, Pair=${pair || "?"}, Price=${priceWbnb ?? "-"} WBNB${
        priceUsd ? ` (~$${priceUsd})` : ""
      }${mc ? `, MarketCap(~$${mc})` : ""}.`;
    }

    if (title.startsWith("LP Lock")) {
      const pair = status?.pairAddress || status?.data?.pairAddress;
      const burnedPct = status?.burn?.burnedPct ?? status?.data?.burn?.burnedPct;
      return `LP status: Pair=${pair || "?"}, Burned=${
        typeof burnedPct === "number" ? burnedPct.toFixed(2) + "%" : "-"
      }.`;
    }

    if (title.startsWith("Security")) {
      const version = status?.version || status?.data?.version;
      const t24 = status?.transfers24h ?? status?.data?.transfers24h;
      const newest = status?.newestIndexedBlock ?? status?.data?.newestIndexedBlock;
      return `Security engine: Version=${version || "-"}, Transfers(24h)=${t24 ?? "-"}, Newest indexed=${newest ?? "-"}.`;
    }

    return "";
  })();

  if (pill === "LIVE") {
    base.whatItMeans = `This module is actively computed from your pipeline (API → indexer/DB → UI). ${liveDetails}`.trim();
    base.whyInvestorsCare =
      "LIVE means this isn’t a static marketing page — it’s monitoring. Investors can watch change over time (volume shifts, liquidity signals, risk flags) instead of relying on screenshots.";
    base.howToRead =
      "Focus on: (1) timestamps/recency, (2) consistency across refreshes, and (3) whether values move logically with on-chain activity. A healthy LIVE module updates smoothly and frequently.";
    base.riskNotes =
      "Even LIVE can be wrong if: RPC misses logs, indexer is behind, re-org edge cases occur, or parsing/decimals logic is off. Treat LIVE as ‘best known from stored data’ — and verify suspicious numbers on BscScan.";
    return base;
  }

  if (pill === "NEXT") {
    base.whatItMeans =
      "UI is ready but backend endpoint is not live (often 404). When the endpoint ships, this will automatically turn LIVE with real numbers.";
    base.whyInvestorsCare =
      "NEXT modules are usually the investor-grade trust layer: verified pair/price, LP lock depth, and real-time confirmations that reduce uncertainty.";
    base.howToRead =
      "Right now it’s a roadmap promise. You should not treat NEXT as evidence — only as a signal of what’s coming.";
    base.riskNotes =
      "Until NEXT becomes LIVE, don’t use it to justify decisions. Investors will want the endpoint + data source transparency.";
    return base;
  }

  if (pill === "PLANNED") {
    base.whatItMeans =
      "This is advanced analytics that will add rule-based detection (risk scoring, anomaly detection, and explainable alerts). Not live yet.";
    base.whyInvestorsCare =
      "PLANNED is where you go from monitoring to intelligence: detecting unusual whale behavior, clustered control, unlock risks, and red flags automatically.";
    base.howToRead =
      "When shipped, it should include: versioning, rule names, thresholds, and ‘why this alert fired’ explanations.";
    base.riskNotes =
      "Without PLANNED modules, investors rely on manual interpretation. PLANNED is critical for investor confidence at scale.";
    return base;
  }

  // ISSUE
  base.whatItMeans = `This module attempted to load but failed. ${status?.reason ? `Reason: ${status.reason}.` : ""}`.trim();
  base.whyInvestorsCare =
    "Reliability builds trust. If key modules error often, investors assume monitoring gaps and lower confidence in displayed metrics.";
  base.howToRead =
    "Check: endpoint exists, backend is healthy, and logs show successful responses. Then refresh and confirm stable uptime.";
  base.riskNotes =
    "Frequent ISSUE status reduces confidence even if other cards look fine. Fixing stability is part of making this investor-grade.";
  return base;
}

export default function RoadmapExplainerPage() {
  const id = getParam("id");

  const snapshot = useMemo(() => {
    if (!id) return null;
    try {
      const raw = sessionStorage.getItem(id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, [id]);

  const derived = useMemo(() => {
    if (!snapshot) {
      return {
        ok: false as const,
        headline: "Roadmap Explainer needs a snapshot from the Daily Audit page.",
        body: "Go back to the Daily Audit page, then click “Investor Explainer” again. That button passes the live snapshot into this tab.",
      };
    }

    const systemOnline = !!snapshot.systemOnline;
    const indexedBlock = snapshot.indexedBlock ?? null;
    const transfers24hCount = snapshot.transfers24hCount ?? 0;

    const dexState = snapshot.dex;
    const lpState = snapshot.lp;
    const secState = snapshot.sec;

    const dexPill = String(snapshot.uiHints?.dexPill || "next").toUpperCase() as Pill;
    const lpPill = String(snapshot.uiHints?.lpPill || "next").toUpperCase() as Pill;
    const secPill = String(snapshot.uiHints?.secPill || "planned").toUpperCase() as Pill;

    const livePill: Pill = systemOnline ? "LIVE" : "ISSUE";

    return {
      ok: true as const,
      systemOnline,
      indexedBlock,
      transfers24hCount,
      lastChecked: snapshot.lastCheckedISO,
      createdAt: snapshot.createdAt,
      sections: [
        {
          key: "live",
          pill: livePill,
          title: "Live Audit",
          raw: {
            health: systemOnline ? "OK" : "FAILED",
            newestIndexed: indexedBlock,
            transfers24h: transfers24hCount,
          },
        },
        { key: "dex", pill: dexPill, title: "DEX Pair + Price/MC", raw: dexState },
        { key: "lp", pill: lpPill, title: "LP Lock Monitor", raw: lpState },
        { key: "sec", pill: secPill, title: "Security Rules Engine", raw: secState },
      ],
    };
  }, [snapshot]);

  return (
    <DailyAuditLayout>
      <Header />

      <section className="panel panel--table">
        <div className="panel-header-row">
          <h2 className="panel-title">Investor Explainer</h2>
          <span className="panel-caption">Daily Audit Roadmap — what “LIVE / NEXT / PLANNED” really means</span>
        </div>

        {!derived.ok ? (
          <div className="panel-muted">
            <b>{derived.headline}</b>
            <div style={{ marginTop: 8 }}>{derived.body}</div>
          </div>
        ) : (
          <>
            <div className="panel-muted" style={{ marginBottom: 10 }}>
              <b>Snapshot created:</b> {niceTime(derived.createdAt)} · <b>Last checked:</b> {niceTime(derived.lastChecked)}
            </div>

            {derived.sections.map((s: any) => {
              const pill = (s.pill || "NEXT") as Pill;
              const exp = explainerForStatus(s.title, s.raw, pill);

              return (
                <div key={s.key} className="audit-roadmap-item" style={{ marginTop: 12 }}>
                  <div className="audit-roadmap-head">
                    <div className="audit-roadmap-bullet" />
                    <div className="audit-roadmap-name">{exp.title}</div>
                    <div
                      className={`roadmap-pill roadmap-pill--${
                        pill === "LIVE" ? "live" : pill === "ISSUE" ? "warn" : pill === "PLANNED" ? "planned" : "next"
                      }`}
                    >
                      {pill}
                    </div>
                  </div>

                  <div className="audit-roadmap-meta" style={{ marginTop: 8 }}>
                    <b>What’s happening:</b> {exp.whatItMeans}
                  </div>

                  <div className="audit-roadmap-meta" style={{ marginTop: 8 }}>
                    <b>Why investors care:</b> {exp.whyInvestorsCare}
                  </div>

                  <div className="audit-roadmap-meta" style={{ marginTop: 8 }}>
                    <b>How to read it:</b> {exp.howToRead}
                  </div>

                  <div className="audit-roadmap-meta" style={{ marginTop: 8 }}>
                    <b>Risk notes:</b> {exp.riskNotes}
                  </div>

                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 800 }}>Show raw snapshot data</summary>
                    <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>
{JSON.stringify(s.raw, null, 2)}
                    </pre>
                  </details>
                </div>
              );
            })}
          </>
        )}
      </section>
    </DailyAuditLayout>
  );
}
