import type { MatchEvent } from "../domain/types.js";
import type { QueryClient } from "../db/client.js";
import { getTeamsByIds } from "../db/repositories/teamLookup.js";
import { getPlayersByIds } from "../db/repositories/playerLookup.js";

export interface EventView extends MatchEvent {
  teamName?: string;
  playerName?: string;
  assistPlayerName?: string;
}

/** Same batch-lookup shape as matchView.ts — one query each for teams/players, not N+1 per event. */
export async function toEventViews(pool: QueryClient, events: MatchEvent[]): Promise<EventView[]> {
  const teamIds = [...new Set(events.map((e) => e.teamId).filter((id): id is string => !!id))];
  const playerIds = [
    ...new Set(events.flatMap((e) => [e.playerId, e.assistPlayerId]).filter((id): id is string => !!id)),
  ];
  const [teams, players] = await Promise.all([getTeamsByIds(pool, teamIds), getPlayersByIds(pool, playerIds)]);

  return events.map((e) => ({
    ...e,
    teamName: e.teamId ? teams.get(e.teamId)?.name : undefined,
    playerName: e.playerId ? players.get(e.playerId)?.name : undefined,
    assistPlayerName: e.assistPlayerId ? players.get(e.assistPlayerId)?.name : undefined,
  }));
}
