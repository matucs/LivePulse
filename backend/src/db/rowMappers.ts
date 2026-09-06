import type { Match, MatchEvent, TeamMatchStatistics, Team, Standing, League } from "../domain/types.js";

/** snake_case DB rows -> camelCase domain types. Keeps SQL files readable (Postgres convention) without leaking that convention into application code. */

export function rowToMatch(row: Record<string, unknown>): Match {
  return {
    id: row.id as string,
    providerId: row.provider_code as string,
    externalId: row.external_id as string,
    leagueId: row.league_id as string,
    seasonId: row.season_id as string,
    homeTeamId: row.home_team_id as string,
    awayTeamId: row.away_team_id as string,
    kickoffAt: (row.kickoff_at as Date).toISOString(),
    status: row.status as Match["status"],
    elapsedMinutes: row.elapsed_minutes === null ? undefined : (row.elapsed_minutes as number),
    homeScore: row.home_score as number,
    awayScore: row.away_score as number,
    venue: (row.venue as string | null) ?? undefined,
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export function rowToTeam(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    providerId: row.provider_code as string,
    externalId: row.external_id as string,
    name: row.name as string,
    shortName: (row.short_name as string | null) ?? undefined,
    country: (row.country as string | null) ?? undefined,
    logoUrl: (row.logo_url as string | null) ?? undefined,
  };
}

export function rowToMatchEvent(row: Record<string, unknown>): MatchEvent {
  return {
    id: row.id as string,
    matchId: row.match_id as string,
    type: row.type as MatchEvent["type"],
    minute: row.minute as number,
    extraMinute: row.extra_minute === null ? undefined : (row.extra_minute as number),
    teamId: (row.team_id as string | null) ?? undefined,
    playerId: (row.player_id as string | null) ?? undefined,
    assistPlayerId: (row.assist_player_id as string | null) ?? undefined,
    detail: (row.detail as string | null) ?? undefined,
    sequenceNumber: row.sequence_number as number,
  };
}

export function rowToStatistics(row: Record<string, unknown>): TeamMatchStatistics {
  return {
    matchId: row.match_id as string,
    teamId: row.team_id as string,
    possessionPct: row.possession_pct === null ? undefined : Number(row.possession_pct),
    shotsTotal: (row.shots_total as number | null) ?? undefined,
    shotsOnTarget: (row.shots_on_target as number | null) ?? undefined,
    corners: (row.corners as number | null) ?? undefined,
    fouls: (row.fouls as number | null) ?? undefined,
    yellowCards: (row.yellow_cards as number | null) ?? undefined,
    redCards: (row.red_cards as number | null) ?? undefined,
    offsides: (row.offsides as number | null) ?? undefined,
  };
}

export function rowToLeague(row: Record<string, unknown>): League {
  return {
    id: row.id as string,
    providerId: row.provider_code as string,
    externalId: row.external_id as string,
    sportCode: "football",
    name: row.name as string,
    country: (row.country as string | null) ?? undefined,
    logoUrl: (row.logo_url as string | null) ?? undefined,
    type: row.type as League["type"],
  };
}

export function rowToStanding(row: Record<string, unknown>): Standing {
  return {
    seasonId: row.season_id as string,
    teamId: row.team_id as string,
    rank: row.rank as number,
    played: row.played as number,
    won: row.won as number,
    drawn: row.drawn as number,
    lost: row.lost as number,
    goalsFor: row.goals_for as number,
    goalsAgainst: row.goals_against as number,
    points: row.points as number,
    form: (row.form as string | null) ?? undefined,
  };
}
