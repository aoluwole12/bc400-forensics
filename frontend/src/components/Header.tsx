import React from "react";
import { useNavigate } from "react-router-dom";

type SubItem = {
  label: string;
  hint: string;
  route?: string;      // ✅ NEW
  anchorId?: string;
};

type NavGroup = {
  label: string;
  items: SubItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Radical Transparency",
    items: [
      { label: "Project Truth Dashboard", hint: "Radical transparency metrics & chain integrity checks." },
      { label: "Governance Tracker", hint: "Whale power, DEX actions and key community decisions." },
      { label: "Dev Activity Log", hint: "Dev pushes, contract changes and upgrade notices." },
    ],
  },
  {
    label: "Security & Safety",
    items: [{ label: "Proof of Safety Panel", hint: "LP lock, renounce status and safety signals in one view." }],
  },
  {
    label: "Security & Alerts",
    items: [
      { label: "Whale & Smart-Money Radar", hint: "Track large wallets, smart money flows and clusters." },
      { label: "Malicious Behavior Guard", hint: "Catch shady patterns, rapid dumps and suspicious clusters." },
      { label: "LP & Price Monitor", hint: "Live LP depth, volatility bands and critical price levels." },
      { label: "Security Feed", hint: "Stream of alerts, incident notes and mitigations." },
    ],
  },
  {
    label: "Bots & Automation",
    items: [
      { label: "Whale Alert Bot", hint: "Hot-list Telegram/Discord whale move alerts." },
      { label: "State-of-Chain Bot", hint: "24/7 pulse on chain health and key metrics." },
      {
        label: "Daily Audit Report",
        hint: "Human-style recap of the last 24h for BC400.",
        route: "/daily-audit", // ✅ route instead of anchor
      },
    ],
  },
  {
    label: "AI Auditor",
    items: [{ label: "AI Auditor Console", hint: "LLM-powered explanations of on-chain behavior." }],
  },
  {
    label: "Docs",
    items: [
      { label: "Product Roadmap", hint: "Releases, milestones and feature roll-out plan." },
      { label: "Schema Reference", hint: "Tables, joins, column meanings and sample SQL." },
      { label: "Ops Runbook", hint: "How to operate the indexer, backfill and jobs safely." },
    ],
  },
];

export const Header: React.FC = () => {
  const navigate = useNavigate();

  const handleClick = (item: SubItem) => {
    if (item.route) {
      navigate(item.route);
      return;
    }

    if (item.anchorId) {
      const el = document.getElementById(item.anchorId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    window.alert(`${item.label}\n\n${item.hint}\n\nComing soon to BC400 Forensics.`);
  };

  return (
    <header className="app-header">
      <div>
        <h1 className="app-title">#BC400 FORENSICS</h1>
        <p className="app-subtitle">Live on-chain activity &amp; security intel for BC400 holders.</p>
      </div>

      <nav className="app-nav">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <button type="button" className="nav-group-label">
              {group.label}
            </button>
            <div className="nav-dropdown">
              {group.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="nav-dropdown-item"
                  onClick={() => handleClick(item)}
                >
                  <span className="nav-item-title">{item.label}</span>
                  <span className="nav-item-hint">{item.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </header>
  );
};
