import { Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { Header } from "./components/Header";
import { DashboardPage } from "./pages/DashboardPage";
import { DailyAuditPage } from "./pages/DailyAuditPage";

export default function App() {
  return (
    <div className="app-root">
      <div className="app-shell">
        <Header />

        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/daily-audit" element={<DailyAuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
