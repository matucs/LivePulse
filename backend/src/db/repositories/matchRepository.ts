import type { QueryClient } from "../client.js";
import type { Match, MatchEvent, TeamMatchStatistics } from "../../domain/types.js";
import { getProviderId } from "./providerRepository.js";
import { rowToMatch, rowToMatchEvent, rowToStatistics } from "../rowMappers.js";

const SELECT_MATCH = `
  SELECT m.*, dp.code AS provider_code
  FROM matches m
  JOIN data_providers dp ON dp.id = m.provider_id
`;

export async function getMatchById(client: QueryClient, id: string): Promise<Match | null> {
  const { rows } = await client.query(`${SELECT_MATCH} WHERE m.id = $1`, [id]);
  return rows[0] ? rowToMatch(rows[0]) : null;
}

export async function listLiveMatches(client: QueryClient): Promise<Match[]> {
  const { rows } = await client.query(`${SELECT_MATCH} WHERE m.status IN ('live','halftime') ORDER BY m.kickoff_at`);
  return rows.map(rowToMatch);
}

export async function listUpcomingMatches(client: QueryClient, from: Date, to: Date): Promise<Match[]> {
  const { rows } = await client.query(
    `${SELECT_MATCH} WHERE m.status = 'scheduled' AND m.kickoff_at BETWEEN $1 AND $2 ORDER BY m.kickoff_at`,
    [from, to],
  );
  return rows.map(rowToMatch);
}

export async function listRecentMatches(client: QueryClient, limit = 20): Promise<Match[]> {
  const { rows } = await client.query(
    `${SELECT_MATCH} WHERE m.status = 'finished' ORDER BY m.kickoff_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(rowToMatch);
}

/**
 * Upserts a match's core fields. Returns whether this call actually
 * changed anything meaningful (score/status/elapsed) — used by the change
 * detector (docs/change-detection.md) as the Postgres-fallback comparison
 * when Redis has no cached prior state.
 */
export async function upsertMatch(client: QueryClient, match: Match): Promise<void> {
  const providerId = await getProviderId(client, match.providerId);
  await client.query(
    `INSERT INTO matches (
       id, provider_id, external_id, league_id, season_id, home_team_id, away_team_id,
       kickoff_at, status, elapsed_minutes, home_score, away_score, venue,
       last_polled_at, last_changed_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       elapsed_minutes = EXCLUDED.elapsed_minutes,
       home_score = EXCLUDED.home_score,
       away_score = EXCLUDED.away_score,
       venue = EXCLUDED.venue,
       last_polled_at = now(),
       last_changed_at = now(),
       updated_at = now()`,
    [
      match.id,
      providerId,
      match.externalId,
      match.leagueId,
      match.seasonId,
      match.homeTeamId,
      match.awayTeamId,
      match.kickoffAt,
      match.status,
      match.elapsedMinutes ?? null,
      match.homeScore,
      match.awayScore,
      match.venue ?? null,
    ],
  );
}

/** Bookkeeping-only touch (docs/ingestion.md step 1) — no domain event, just last_polled_at. */
export async function touchLastPolled(client: QueryClient, matchId: string): Promise<void> {
  await client.query(`UPDATE matches SET last_polled_at = now() WHERE id = $1`, [matchId]);
}

/**
 * Idempotent insert — unique on (match_id, sequence_number), so redelivery
 * or re-polling the same event is a no-op (docs/change-detection.md).
 */
export async function insertMatchEvent(client: QueryClient, event: MatchEvent): Promise<{ inserted: boolean }> {
  const { rowCount } = await client.query(
    `INSERT INTO match_events (match_id, type, minute, extra_minute, team_id, player_id, assist_player_id, detail, sequence_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (match_id, sequence_number) DO NOTHING`,
    [
      event.matchId,
      event.type,
      event.minute,
      event.extraMinute ?? null,
      event.teamId ?? null,
      event.playerId ?? null,
      event.assistPlayerId ?? null,
      event.detail ?? null,
      event.sequenceNumber,
    ],
  );
  return { inserted: (rowCount ?? 0) > 0 };
}

export async function getMatchEvents(client: QueryClient, matchId: string): Promise<MatchEvent[]> {
  const { rows } = await client.query(`SELECT * FROM match_events WHERE match_id = $1 ORDER BY minute`, [matchId]);
  return rows.map(rowToMatchEvent);
}

export async function upsertMatchStatistics(client: QueryClient, stats: TeamMatchStatistics): Promise<void> {
  await client.query(
    `INSERT INTO match_statistics (match_id, team_id, possession_pct, shots_total, shots_on_target, corners, fouls, yellow_cards, red_cards, offsides, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (match_id, team_id) DO UPDATE SET
       possession_pct = EXCLUDED.possession_pct,
       shots_total = EXCLUDED.shots_total,
       shots_on_target = EXCLUDED.shots_on_target,
       corners = EXCLUDED.corners,
       fouls = EXCLUDED.fouls,
       yellow_cards = EXCLUDED.yellow_cards,
       red_cards = EXCLUDED.red_cards,
       offsides = EXCLUDED.offsides,
       updated_at = now()`,
    [
      stats.matchId,
      stats.teamId,
      stats.possessionPct ?? null,
      stats.shotsTotal ?? null,
      stats.shotsOnTarget ?? null,
      stats.corners ?? null,
      stats.fouls ?? null,
      stats.yellowCards ?? null,
      stats.redCards ?? null,
      stats.offsides ?? null,
    ],
  );
}

export async function getMatchStatistics(client: QueryClient, matchId: string): Promise<TeamMatchStatistics[]> {
  const { rows } = await client.query(`SELECT * FROM match_statistics WHERE match_id = $1`, [matchId]);
  return rows.map(rowToStatistics);
}
