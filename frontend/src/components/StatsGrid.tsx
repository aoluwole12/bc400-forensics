import StatsCard from "./StatsCard";

export type StatCardData = {
  id: string;
  label: string;
  value: string;
  helper?: string;
};

export default function StatsGrid({
  stats,
  columns = 3,
}: {
  stats: StatCardData[];
  columns?: number;
}) {
  return (
    <section
      className="stats-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      aria-label="BC400 stats grid"
    >
      {stats.map((s) => (
        <StatsCard key={s.id} label={s.label} value={s.value} helper={s.helper} />
      ))}
    </section>
  );
}