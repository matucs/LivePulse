import type { TeamMatchStatistics } from "@/lib/apiClient";

interface Row {
  label: string;
  home?: number;
  away?: number;
  suffix?: string;
}

/** A single side-by-side bar comparing two values — the visual language of a real match-stats panel, not a table. */
function StatRow({ label, home, away, suffix = "" }: Row) {
  const h = home ?? 0;
  const a = away ?? 0;
  const total = h + a || 1;
  const homePct = (h / total) * 100;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
        <span className="tabular-nums">
          {home ?? "–"}
          {suffix}
        </span>
        <span>{label}</span>
        <span className="tabular-nums">
          {away ?? "–"}
          {suffix}
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div className="bg-accent" style={{ width: `${homePct}%` }} />
        <div className="flex-1 bg-border" />
      </div>
    </div>
  );
}

export function StatisticsPanel({
  home,
  away,
}: {
  home?: TeamMatchStatistics;
  away?: TeamMatchStatistics;
}) {
  if (!home && !away) {
    return <p className="text-sm text-text-muted">No statistics available yet for this match.</p>;
  }

  return (
    <div className="space-y-4">
      <StatRow label="Possession" home={home?.possessionPct} away={away?.possessionPct} suffix="%" />
      <StatRow label="Shots" home={home?.shotsTotal} away={away?.shotsTotal} />
      <StatRow label="Shots on Target" home={home?.shotsOnTarget} away={away?.shotsOnTarget} />
      <StatRow label="Corners" home={home?.corners} away={away?.corners} />
      <StatRow label="Fouls" home={home?.fouls} away={away?.fouls} />
      <StatRow label="Yellow Cards" home={home?.yellowCards} away={away?.yellowCards} />
      <StatRow label="Red Cards" home={home?.redCards} away={away?.redCards} />
    </div>
  );
}
