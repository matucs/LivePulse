/**
 * Raw football-data.org v4 response shapes — only the fields LivePulse
 * actually reads. Mirrors the same discipline as apiFootballTypes.ts: this
 * is the only file allowed to know these field names.
 */

export interface FootballDataTeamRef {
  id: number;
  name: string;
  shortName: string | null;
  crest: string | null;
}

export interface FootballDataStandingRow {
  position: number;
  team: FootballDataTeamRef;
  playedGames: number;
  form: string | null;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface FootballDataStandingsGroup {
  // "TOTAL" | "HOME" | "AWAY" — only TOTAL is used (matches ADR-005's
  // single current-snapshot-per-team standings schema, not split by venue).
  type: string;
  table: FootballDataStandingRow[];
}

export interface FootballDataStandingsResponse {
  competition: { id: number; code: string; name: string };
  standings: FootballDataStandingsGroup[];
}

/**
 * Unlike API-Football (HTTP 200 + a populated `errors` field even on
 * rejection — the mistake fixed in the ADR-002 addendum), football-data.org
 * uses real HTTP status codes (403 for auth problems, 429 for rate limits)
 * with a JSON body shaped like this. Read only for logging context when
 * `!res.ok` — the HTTP status itself is what drives control flow here, not
 * a body field.
 */
export interface FootballDataErrorResponse {
  message: string;
}
