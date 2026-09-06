/**
 * Raw API-Football v3 response shapes — only the fields LivePulse actually
 * reads. This file is the ONLY place that should know these field names;
 * everything else works with docs/data-provider.md's domain types.
 */

export interface ApiFootballTeamRef {
  id: number;
  name: string;
  logo: string;
  winner?: boolean | null;
}

export interface ApiFootballFixtureStatus {
  long: string;
  short: string; // 'NS' | '1H' | 'HT' | '2H' | 'ET' | 'FT' | 'PST' | 'CANC' | ...
  elapsed: number | null;
}

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string; // ISO 8601
    timestamp: number;
    venue: { id: number | null; name: string | null; city: string | null };
    status: ApiFootballFixtureStatus;
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    season: number;
    round: string;
  };
  teams: {
    home: ApiFootballTeamRef;
    away: ApiFootballTeamRef;
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

export interface ApiFootballFixturesResponse {
  response: ApiFootballFixture[];
}

export interface ApiFootballEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string; logo: string };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string; // 'Goal' | 'Card' | 'Subst' | 'Var'
  detail: string; // 'Normal Goal' | 'Yellow Card' | 'Red Card' | 'Substitution 1' | ...
  comments: string | null;
}

export interface ApiFootballEventsResponse {
  response: ApiFootballEvent[];
}

export interface ApiFootballStatItem {
  type: string; // 'Shots on Goal' | 'Ball Possession' | 'Corner Kicks' | ...
  value: number | string | null;
}

export interface ApiFootballStatistics {
  team: { id: number; name: string; logo: string };
  statistics: ApiFootballStatItem[];
}

export interface ApiFootballStatisticsResponse {
  response: ApiFootballStatistics[];
}

export interface ApiFootballStandingRow {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  form: string | null;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
}

export interface ApiFootballStandingsResponse {
  response: Array<{
    league: {
      id: number;
      standings: ApiFootballStandingRow[][];
    };
  }>;
}
