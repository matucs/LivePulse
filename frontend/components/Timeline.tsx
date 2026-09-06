import type { MatchEvent } from "@/lib/apiClient";

const EVENT_ICON: Record<MatchEvent["type"], string> = {
  goal: "⚽",
  yellow_card: "🟨",
  red_card: "🟥",
  substitution: "🔄",
  var: "📺",
  kickoff: "▶️",
  halftime: "⏸️",
  fulltime: "⏹️",
  status_change: "•",
};

const EVENT_LABEL: Record<MatchEvent["type"], string> = {
  goal: "Goal",
  yellow_card: "Yellow Card",
  red_card: "Red Card",
  substitution: "Substitution",
  var: "VAR",
  kickoff: "Kick-off",
  halftime: "Half-time",
  fulltime: "Full-time",
  status_change: "Status change",
};

export function Timeline({ events }: { events: MatchEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-text-muted">No events yet.</p>;
  }

  const sorted = [...events].sort((a, b) => a.minute - b.minute);

  return (
    <ol className="space-y-3">
      {sorted.map((event) => (
        <li key={event.id} className="flex items-start gap-3 text-sm">
          <span className="w-10 shrink-0 tabular-nums text-text-muted">
            {event.minute}
            {event.extraMinute ? `+${event.extraMinute}` : ""}&apos;
          </span>
          <span aria-hidden>{EVENT_ICON[event.type]}</span>
          <span>
            <span className="font-medium">{EVENT_LABEL[event.type]}</span>
            {event.playerName ? <> — {event.playerName}</> : null}
            {event.assistPlayerName ? <span className="text-text-muted"> (assist: {event.assistPlayerName})</span> : null}
            {event.teamName ? <span className="block text-xs text-text-muted">{event.teamName}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
