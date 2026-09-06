-- Initial schema — see docs/adr/ADR-005-postgresql-schema.md for full
-- rationale. This file is the literal DDL from that ADR; keep them in sync.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE data_providers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    base_url    text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sports (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code  text NOT NULL UNIQUE,
    name  text NOT NULL
);

CREATE TABLE leagues (
    id           uuid PRIMARY KEY,
    sport_id     uuid NOT NULL REFERENCES sports(id),
    provider_id  uuid NOT NULL REFERENCES data_providers(id),
    external_id  text NOT NULL,
    name         text NOT NULL,
    country      text,
    logo_url     text,
    type         text NOT NULL DEFAULT 'league' CHECK (type IN ('league','cup')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider_id, external_id)
);
CREATE INDEX idx_leagues_sport ON leagues(sport_id);

CREATE TABLE seasons (
    id          uuid PRIMARY KEY,
    league_id   uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    label       text NOT NULL,
    start_date  date,
    end_date    date,
    is_current  boolean NOT NULL DEFAULT false,
    UNIQUE (league_id, label)
);
CREATE INDEX idx_seasons_league_current ON seasons(league_id) WHERE is_current;

CREATE TABLE teams (
    id           uuid PRIMARY KEY,
    provider_id  uuid NOT NULL REFERENCES data_providers(id),
    external_id  text NOT NULL,
    name         text NOT NULL,
    short_name   text,
    country      text,
    logo_url     text,
    founded_year int,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider_id, external_id)
);

CREATE TABLE players (
    id           uuid PRIMARY KEY,
    provider_id  uuid NOT NULL REFERENCES data_providers(id),
    external_id  text NOT NULL,
    team_id      uuid REFERENCES teams(id),
    name         text NOT NULL,
    position     text,
    nationality  text,
    birth_date   date,
    UNIQUE (provider_id, external_id)
);
CREATE INDEX idx_players_team ON players(team_id);

CREATE TABLE matches (
    id              uuid PRIMARY KEY,
    provider_id     uuid NOT NULL REFERENCES data_providers(id),
    external_id     text NOT NULL,
    league_id       uuid NOT NULL REFERENCES leagues(id),
    season_id       uuid NOT NULL REFERENCES seasons(id),
    home_team_id    uuid NOT NULL REFERENCES teams(id),
    away_team_id    uuid NOT NULL REFERENCES teams(id),
    kickoff_at      timestamptz NOT NULL,
    status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','live','halftime','finished','postponed','cancelled')),
    elapsed_minutes int,
    home_score      int NOT NULL DEFAULT 0,
    away_score      int NOT NULL DEFAULT 0,
    venue           text,
    last_polled_at  timestamptz,
    last_changed_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider_id, external_id),
    CHECK (home_team_id <> away_team_id)
);
CREATE INDEX idx_matches_status_kickoff ON matches(status, kickoff_at);
CREATE INDEX idx_matches_league_season ON matches(league_id, season_id);

CREATE TABLE match_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id         uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    type             text NOT NULL
                     CHECK (type IN ('goal','yellow_card','red_card','substitution','var','kickoff','halftime','fulltime','status_change')),
    minute           int NOT NULL,
    extra_minute     int,
    team_id          uuid REFERENCES teams(id),
    player_id        uuid REFERENCES players(id),
    assist_player_id uuid REFERENCES players(id),
    detail           text,
    sequence_number  int NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (match_id, sequence_number)
);
CREATE INDEX idx_match_events_match ON match_events(match_id, minute);

CREATE TABLE match_statistics (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id       uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id        uuid NOT NULL REFERENCES teams(id),
    possession_pct numeric(5,2),
    shots_total    int,
    shots_on_target int,
    corners        int,
    fouls          int,
    yellow_cards   int,
    red_cards      int,
    offsides       int,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (match_id, team_id)
);

CREATE TABLE standings (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id      uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    team_id        uuid NOT NULL REFERENCES teams(id),
    rank           int NOT NULL,
    played         int NOT NULL DEFAULT 0,
    won            int NOT NULL DEFAULT 0,
    drawn          int NOT NULL DEFAULT 0,
    lost           int NOT NULL DEFAULT 0,
    goals_for      int NOT NULL DEFAULT 0,
    goals_against  int NOT NULL DEFAULT 0,
    points         int NOT NULL DEFAULT 0,
    form           text,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (season_id, team_id)
);
CREATE INDEX idx_standings_season_rank ON standings(season_id, rank);

-- Seed the one provider LivePulse uses today (docs/adr/ADR-001/ADR-007).
INSERT INTO data_providers (code, name, base_url)
VALUES ('api-football', 'API-Football', 'https://v3.football.api-sports.io')
ON CONFLICT (code) DO NOTHING;

INSERT INTO sports (code, name)
VALUES ('football', 'Football')
ON CONFLICT (code) DO NOTHING;
