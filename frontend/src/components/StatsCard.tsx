export interface StatsCardProps {
  label: string; // allows "\n" for multi-line labels
  value: string;
}

function StatsCard({ label, value }: StatsCardProps) {
  return (
    <article className="stats-card">
      <div className="stats-card-label">
        {label.split('\n').map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
      <div className="stats-card-value">{value}</div>
    </article>
  );
}

export default StatsCard;