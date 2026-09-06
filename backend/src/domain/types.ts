/**
 * Internal domain model. Nothing outside providers/mappers/* should ever
 * see a provider's own response shape — see docs/adr/ADR-007 and
 * docs/data-provider.md. Every provider-sourced entity carries
 * (providerId, externalId) so multiple providers can coexist without ID
 * collisions (docs/adr/ADR-005).
 */

export type MatchStatus =
  | "scheduled"
  | "live"
  | "halftime"
  | "finished"
  | "postponed"
  | "cancelled";

export type MatchEventType =
  | "goal"
  | "yellow_card"
  | "red_card"
  | "substitution"
  | "var"
  | "kickoff"
  | "halftime"
  | "fulltime"
  | "status_change";

export interface ProviderRef {
  providerId: string;
  externalId: string;
}

export interface Team extends ProviderRef {
  id: string;
  name: string;
  shortName?: string;
  country?: string;
  logoUrl?: string;
  foundedYear?: number;
}

export interface Player extends ProviderRef {
  id: string;
  teamId?: string;
  name: string;
  position?: string;
  nationality?: string;
  birthDate?: string;
}

export interface League extends ProviderRef {
  id: string;
  sportCode: "football";
  name: string;
  country?: string;
  logoUrl?: string;
  type: "league" | "cup";
}

export interface Season {
  id: string;
  leagueId: string;
  label: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

export interface Match extends ProviderRef {
  id: string;
  leagueId: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffAt: string; // ISO 8601
  status: MatchStatus;
  elapsedMinutes?: number;
  homeScore: number;
  awayScore: number;
  venue?: string;
  /** Postgres row's updated_at — the freshness fallback for matches not backed by a live Redis cache entry (docs/caching.md). */
  updatedAt?: string;
}

export interface MatchEvent {
  id?: string;
  matchId: string;
  type: MatchEventType;
  minute: number;
  extraMinute?: number;
  teamId?: string;
  playerId?: string;
  assistPlayerId?: string;
  detail?: string;
  /**
   * Deterministic, derived from (minute, extraMinute, type, teamExternalId,
   * playerExternalId) at mapping time — see mappers/events.ts. Same input
   * always produces the same number, which is what makes re-ingesting the
   * same provider event idempotent (docs/change-detection.md).
   */
  sequenceNumber: number;
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

export interface Standing {
  seasonId: string;
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

/**
 * What the mapper produces for one polled fixture: the match itself plus
 * everything nested in the same provider response, still fully mapped to
 * domain types. Ingestion decides what's actually new/changed
 * (docs/change-detection.md) — the mapper's job ends at "correct shape."
 */
export interface MappedFixture {
  match: Match;
  league: League;
  season: Pick<Season, "id" | "leagueId" | "label">;
  homeTeam: Team;
  awayTeam: Team;
  /**
   * Minimal stubs (id, name, team) derived from the events list itself —
   * API-Football's fixture/events responses only ever give a player's id,
   * name, and (via the event) their team, never position/nationality/
   * birth date. A full Player record needs a separate /players endpoint
   * call, which isn't in the request budget (ADR-002) just to populate
   * fields nothing in the UI reads yet. Upserted before match_events so
   * the FK (docs/adr/ADR-005) always has something to point to.
   */
  players: Player[];
  events: MatchEvent[];
  statistics: TeamMatchStatistics[];
}
