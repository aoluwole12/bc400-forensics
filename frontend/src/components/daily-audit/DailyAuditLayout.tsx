import type { ReactNode } from "react";

export default function DailyAuditLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
