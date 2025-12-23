import type { ReactNode } from "react";

export default function DailyAuditLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-root">
      <div className="app-shell">{children}</div>
    </div>
  );
}