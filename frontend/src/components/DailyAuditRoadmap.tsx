import React from "react";

type Step = {
  title: string;
  status: "live" | "next" | "planned";
  description: string;
};

const STEPS: Step[] = [
  {
    title: "Live Audit (Now)",
    status: "live",
    description:
      "Built only from existing endpoints: /health, /summary, /top-holders, /transfers.",
  },
  {
    title: "DEX Pair + Price/MC (Next)",
    status: "next",
    description:
      "Auto-detect PancakeSwap pair, pull reserves, price in WBNB + USD, market cap.",
  },
  {
    title: "LP Lock Monitor (Next)",
    status: "next",
    description:
      "Detect lockers + lock %, alert on unlocks, pulls, owner changes, LP burns.",
  },
  {
    title: "Security Rules Engine (Planned)",
    status: "planned",
    description:
      "Exploit signals, blacklists, pausable events, admin changes, suspicious mint/burn.",
  },
];

export const DailyAuditRoadmap: React.FC = () => {
  return (
    <div className="roadmap">
      <div className="roadmap-title">Daily Audit Roadmap</div>
      <div className="roadmap-grid">
        {STEPS.map((s) => (
          <div
            key={s.title}
            className={
              s.status === "live"
                ? "roadmap-card roadmap-card--live"
                : s.status === "next"
                ? "roadmap-card roadmap-card--next"
                : "roadmap-card"
            }
          >
            <div className="roadmap-top">
              <span className="roadmap-dot" />
              <span className="roadmap-name">{s.title}</span>
              <span className="roadmap-tag">
                {s.status === "live" ? "LIVE" : s.status === "next" ? "NEXT" : "PLANNED"}
              </span>
            </div>
            <div className="roadmap-desc">{s.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
