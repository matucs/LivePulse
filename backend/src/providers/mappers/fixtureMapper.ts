import type {
  ApiFootballEvent,
  ApiFootballFixture,
  ApiFootballStatistics,
  ApiFootballStandingRow,
} from "./apiFootballTypes.js";
import type { League, MappedFixture, MatchEvent, Player, Standing, Team } from "../../domain/types.js";
import { deriveId } from "../../domain/deriveId.js";
import { mapStatus } from "./statusMap.js";
import { deriveEventSequenceNumber, mapEventType } from "./eventMapper.js";
import { mapStatistics } from "./statisticsMapper.js";

export const PROVIDER_CODE = "api-football" as const;

function mapTeam(raw: ApiFootballFixture["teams"]["home"]): Team {
  return {
    id: deriveId(PROVIDER_CODE, "team", String(raw.id)),
    providerId: PROVIDER_CODE,
    externalId: String(raw.id),
    name: raw.name,
    logoUrl: raw.logo,
  };
}

/** Derived from (league external id, season year) — API-Football scopes seasons to a league+year, not a separate entity with its own id. */
export function deriveSeasonId(leagueExternalId: string, seasonYear: number): string {
  return deriveId(PROVIDER_CODE, "season", `${leagueExternalId}:${seasonYear}`);
}

export function mapEvents(matchId: string, raw: ApiFootballEvent[]): MatchEvent[] {
  return raw.map((e) => ({
    matchId,
    type: mapEventType(e),
    minute: e.time.elapsed,
    extraMinute: e.time.extra ?? undefined,
    teamId: deriveId(PROVIDER_CODE, "team", String(e.team.id)),
    playerId: e.player.id !== null ? deriveId(PROVIDER_CODE, "player", String(e.player.id)) : undefined,
    assistPlayerId: e.assist.id !== null ? deriveId(PROVIDER_CODE, "player", String(e.assist.id)) : undefined,
    detail: e.detail,
    sequenceNumber: deriveEventSequenceNumber({
      minute: e.time.elapsed,
      extraMinute: e.time.extra,
      type: e.type,
      teamExternalId: e.team.id,
      playerExternalId: e.player.id,
    }),
  }));
}

/**
 * Distinct player stubs referenced by an events list — both scorers and
 * assist-providers. An assist is assumed to belong to the same team as the
 * event's own team (true for goals/substitutions, the only event types
 * that carry an assist field in practice) — a documented simplification,
 * not verified against a separate source.
 */
export function mapPlayersFromEvents(raw: ApiFootballEvent[]): Player[] {
  const byExternalId = new Map<number, Player>();
  for (const e of raw) {
    const teamId = deriveId(PROVIDER_CODE, "team", String(e.team.id));
    if (e.player.id !== null && e.player.name !== null) {
      byExternalId.set(e.player.id, {
        id: deriveId(PROVIDER_CODE, "player", String(e.player.id)),
        providerId: PROVIDER_CODE,
        externalId: String(e.player.id),
        teamId,
        name: e.player.name,
      });
    }
    if (e.assist.id !== null && e.assist.name !== null) {
      byExternalId.set(e.assist.id, {
        id: deriveId(PROVIDER_CODE, "player", String(e.assist.id)),
        providerId: PROVIDER_CODE,
        externalId: String(e.assist.id),
        teamId,
        name: e.assist.name,
      });
    }
  }
  return [...byExternalId.values()];
}

/**
 * Not called by ApiFootballProvider's current public surface — its
 * getStandings() was removed after real-key validation showed the free
 * tier rejects it for any current season (ADR-002 addendum). Kept here,
 * tested, because it's still correct for API-Football's own free-tier
 * historical window (2022-2024, confirmed by direct testing) — a
 * plausible future "browse a past season" feature would want exactly this,
 * without re-deriving the mapping from scratch. FootballDataProvider
 * (ADR-007 addendum) is what actually supplies current-season standings.
 */
export function mapStandings(seasonId: string, raw: ApiFootballStandingRow[]): Standing[] {
  return raw.map((row) => ({
    seasonId,
    teamId: deriveId(PROVIDER_CODE, "team", String(row.team.id)),
    rank: row.rank,
    played: row.all.played,
    won: row.all.win,
    drawn: row.all.draw,
    lost: row.all.lose,
    goalsFor: row.all.goals.for,
    goalsAgainst: row.all.goals.against,
    points: row.points,
    form: row.form ?? undefined,
  }));
}

/**
 * Maps one API-Football fixture (the shape returned by /fixtures,
 * /fixtures?live=all, /fixtures?id=) into the internal domain model.
 * Events and statistics are mapped separately (mapEvents/mapStatistics)
 * since they come from different endpoints and aren't always fetched
 * together (docs/adr/ADR-002's request budget).
 */
export function mapFixture(
  raw: ApiFootballFixture,
  events: ApiFootballEvent[] = [],
  statistics: ApiFootballStatistics[] = [],
): MappedFixture {
  const matchId = deriveId(PROVIDER_CODE, "match", String(raw.fixture.id));
  const leagueId = deriveId(PROVIDER_CODE, "league", String(raw.league.id));
  const seasonId = deriveSeasonId(String(raw.league.id), raw.league.season);
  const homeTeam = mapTeam(raw.teams.home);
  const awayTeam = mapTeam(raw.teams.away);

  const league: League = {
    id: leagueId,
    providerId: PROVIDER_CODE,
    externalId: String(raw.league.id),
    sportCode: "football",
    name: raw.league.name,
    country: raw.league.country,
    logoUrl: raw.league.logo,
    // The fixture-scoped league object doesn't carry league/cup type —
    // that's only on API-Football's separate /leagues endpoint, which
    // isn't in the request budget (ADR-002) for something purely cosmetic.
    // Defaulted; a documented simplification, not a bug.
    type: "league",
  };

  return {
    match: {
      id: matchId,
      providerId: PROVIDER_CODE,
      externalId: String(raw.fixture.id),
      leagueId,
      seasonId,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt: raw.fixture.date,
      status: mapStatus(raw.fixture.status.short),
      elapsedMinutes: raw.fixture.status.elapsed ?? undefined,
      homeScore: raw.goals.home ?? 0,
      awayScore: raw.goals.away ?? 0,
      venue: raw.fixture.venue.name ?? undefined,
    },
    league,
    season: { id: seasonId, leagueId, label: String(raw.league.season) },
    homeTeam,
    awayTeam,
    players: mapPlayersFromEvents(events),
    events: mapEvents(matchId, events),
    statistics: mapStatistics(matchId, PROVIDER_CODE, statistics),
  };
}
