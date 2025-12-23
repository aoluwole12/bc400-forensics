import { Routes, Route, Navigate } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import DailyAuditPage from "./pages/DailyAuditPage";
import RoadmapExplainerPage from "./pages/RoadmapExplainerPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/daily-audit" element={<DailyAuditPage />} />

      {/* Daily Audit Roadmap -> Investor Explainer (opens in new tab) */}
      <Route
        path="/daily-audit/roadmap-explainer"
        element={<RoadmapExplainerPage />}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
