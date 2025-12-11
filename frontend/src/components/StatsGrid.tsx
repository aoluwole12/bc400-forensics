import StatsCard from './StatsCard';

export interface StatCardData {
  id: string;
  label: string;
  value: string;
}

interface StatsGridProps {
  stats: StatCardData[];
}

function StatsGrid({ stats }: StatsGridProps) {
  return (
    <section className="stats-section" aria-label="BC400 summary">
      <div className="stats-grid">
        {stats.map((stat) => (
          <StatsCard key={stat.id} label={stat.label} value={stat.value} />
        ))}
      </div>
    </section>
  );
}

export default StatsGrid;