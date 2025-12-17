export interface StatsCardProps {
  label: string;     // supports "LINE1\nLINE2"
  value: string;
  helper?: string;
}

export default function StatsCard({ label, value, helper }: StatsCardProps) {
  return (
    <article className="stats-card">
      <div className="stats-card-label">
        {label.split("\n").map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </div>

      <div className="stats-card-value">{value}</div>

      {helper ? <div className="stats-card-helper">{helper}</div> : null}
    </article>
  );
}