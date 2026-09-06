/**
 * The only file that knows the backend's base URL. Never talks to
 * API-Football directly — the browser only ever sees LivePulse's own
 * backend (docs/adr/ADR-007, §24: no external API key ever reaches here).
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface TeamSummary {
  id: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
}

export interface MatchView {
  id: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  kickoffAt: string;
  status: "scheduled" | "live" | "halftime" | "finished" | "postponed" | "cancelled";
  elapsedMinutes?: number;
  homeScore: number;
  awayScore: number;
  venue?: string;
  dataFreshnessSeconds: number;
  isStale: boolean;
}

export interface MatchEvent {
  id: string;
  matchId: string;
  type: "goal" | "yellow_card" | "red_card" | "substitution" | "var" | "kickoff" | "halftime" | "fulltime" | "status_change";
  minute: number;
  extraMinute?: number;
  teamId?: string;
  playerId?: string;
  assistPlayerId?: string;
  detail?: string;
  teamName?: string;
  playerName?: string;
  assistPlayerName?: string;
}

export interface TeamMatchStatistics {
  matchId: string;
  teamId: string;
  possessionPct?: number;
  shotsTotal?: number;
  shotsOnTarget?: number;
  corners?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  offsides?: number;
}

export interface League {
  id: string;
  name: string;
  country?: string;
  logoUrl?: string;
}

export interface Standing {
  teamId: string;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form?: string;
}

/** §15's engineering dashboard fields — computed backend-side (backend/src/api/routes/ops.ts) from the same instruments docs/observability.md describes, not recalculated here. */
export interface OpsSummary {
  liveMatches: number;
  kafkaEventsPerSecond: number;
  kafkaConsumerLagMax: number;
  websocketConnections: number;
  apiRequestsToday: number;
  apiRequestsRemaining: number | null;
  redisHitRate: number | null;
  eventProcessingLatencyAvgSeconds: number | null;
  failedEvents: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API request to ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  liveMatches: () => get<{ matches: MatchView[] }>("/api/matches/live"),
  upcomingMatches: () => get<{ matches: MatchView[] }>("/api/matches/upcoming"),
  recentMatches: (limit = 20) => get<{ matches: MatchView[] }>(`/api/matches/recent?limit=${limit}`),
  match: (id: string) => get<MatchView>(`/api/matches/${id}`),
  matchEvents: (id: string) => get<{ events: MatchEvent[] }>(`/api/matches/${id}/events`),
  matchStatistics: (id: string) => get<{ statistics: TeamMatchStatistics[] }>(`/api/matches/${id}/statistics`),
  leagues: () => get<{ leagues: League[] }>("/api/leagues"),
  standings: (leagueId: string) => get<{ seasonId: string; standings: Standing[] }>(`/api/leagues/${leagueId}/standings`),
  opsSummary: () => get<OpsSummary>("/api/ops/summary"),
};
