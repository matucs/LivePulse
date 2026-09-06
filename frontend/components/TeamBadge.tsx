import type { TeamSummary } from "@/lib/apiClient";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

/**
 * Plain <img>, not next/image — team logos come from API-Football's CDN
 * (media.api-sports.io), an external host that would need remotePatterns
 * config either way, and a broken/missing logo should never take the
 * whole card down. Falls back to initials in a colored circle instead.
 */
export function TeamBadge({ team, size = 28 }: { team: TeamSummary; size?: number }) {
  return (
    <div className="flex items-center gap-2">
      {team.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logoUrl}
          alt=""
          width={size}
          height={size}
          className="shrink-0 rounded-sm object-contain"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <span
          className="flex shrink-0 items-center justify-center rounded-full bg-surface-hover text-[10px] font-semibold text-text-muted"
          style={{ width: size, height: size }}
        >
          {initials(team.name)}
        </span>
      )}
      <span className="truncate font-medium">{team.name}</span>
    </div>
  );
}
