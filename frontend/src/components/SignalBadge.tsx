import React from "react";

type Props = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  hint?: string;
};

export const SignalBadge: React.FC<Props> = ({
  label,
  value,
  tone = "neutral",
  hint,
}) => {
  const klass =
    tone === "ok"
      ? "sig sig--ok"
      : tone === "warn"
      ? "sig sig--warn"
      : tone === "bad"
      ? "sig sig--bad"
      : "sig";

  return (
    <div className={klass} title={hint ?? ""}>
      <div className="sig-label">{label}</div>
      <div className="sig-value">{value}</div>
    </div>
  );
};
