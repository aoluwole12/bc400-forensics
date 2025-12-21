// frontend/src/components/DailyAuditRoadmap.tsx
import React from "react";

type RoadmapItem = {
  title: string;
  lines: string[];
  status: "LIVE" | "NEXT" | "PLANNED";
};

const ITEMS: RoadmapItem[] = [
  {
    title: "Live Audit (Now)",
    status: "LIVE",
    lines: [
      "Built from live API data: /health, /summary, /top-holders, /transfers/latest",
    ],
  },
  {
    title: "DEX Pair + Price/MC (Next)",
    status: "NEXT",
    lines: [
      "DEX: PancakeSwap v2/v3 • Pair: 0x… • Token: BC400 • Price/MC",
      "Note: requires WBNB_USD env on backend",
    ],
  },
  {
    title: "LP Lock Monitor (Next)",
    status: "NEXT",
    lines: [
      "Pair: 0x… • LP burned/locked % • Locker: not verified",
      "Endpoint: /lp/lock",
    ],
  },
  {
    title: "Security Rules Engine (Planned)",
    status: "PLANNED",
    lines: [
      "Rule engine + alerts (wallet labels, heuristics, triggers)",
      "Endpoint: /security/rules",
    ],
  },
];

function chipClass(status: RoadmapItem["status"]) {
  if (status === "LIVE") return "daily-roadmap__chip daily-roadmap__chip--live";
  if (status === "NEXT") return "daily-roadmap__chip daily-roadmap__chip--next";
  return "daily-roadmap__chip daily-roadmap__chip--planned";
}

export function DailyAuditRoadmap() {
  return (
    <div className="daily-roadmap">
      <div className="daily-roadmap__title">Daily Audit Roadmap</div>

      <div className="daily-roadmap__list">
        {ITEMS.map((item) => (
          <div className="daily-roadmap__row" key={`${item.status}-${item.title}`}>
            <div className="daily-roadmap__left">
              <div className="daily-roadmap__rowTitle">{item.title}</div>
              {item.lines.map((line, idx) => (
                <div className="daily-roadmap__line" key={idx}>
                  {line}
                </div>
              ))}
            </div>

            <div className="daily-roadmap__right">
              <span className={chipClass(item.status)}>{item.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}