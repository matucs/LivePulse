import type { QueryClient } from "../client.js";
import type { Standing } from "../../domain/types.js";
import { rowToStanding } from "../rowMappers.js";

export async function upsertStanding(client: QueryClient, standing: Standing): Promise<void> {
  await client.query(
    `INSERT INTO standings (season_id, team_id, rank, played, won, drawn, lost, goals_for, goals_against, points, form, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     ON CONFLICT (season_id, team_id) DO UPDATE SET
       rank = EXCLUDED.rank,
       played = EXCLUDED.played,
       won = EXCLUDED.won,
       drawn = EXCLUDED.drawn,
       lost = EXCLUDED.lost,
       goals_for = EXCLUDED.goals_for,
       goals_against = EXCLUDED.goals_against,
       points = EXCLUDED.points,
       form = EXCLUDED.form,
       updated_at = now()`,
    [
      standing.seasonId,
      standing.teamId,
      standing.rank,
      standing.played,
      standing.won,
      standing.drawn,
      standing.lost,
      standing.goalsFor,
      standing.goalsAgainst,
      standing.points,
      standing.form ?? null,
    ],
  );
}

export async function listStandingsBySeason(client: QueryClient, seasonId: string): Promise<Standing[]> {
  const { rows } = await client.query(`SELECT * FROM standings WHERE season_id = $1 ORDER BY rank`, [seasonId]);
  return rows.map(rowToStanding);
}
