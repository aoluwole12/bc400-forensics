import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import { DailyAuditPage } from "./pages/DailyAuditPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/daily-audit" element={<DailyAuditPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
