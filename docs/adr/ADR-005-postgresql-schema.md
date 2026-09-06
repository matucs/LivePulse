# ADR-005: PostgreSQL Schema

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [architecture.md §3](../architecture.md#3-domain-model), [ADR-007](ADR-007-provider-abstraction.md)

## Context

PostgreSQL is the durable source of truth (§11) and must stay
provider-independent: nothing outside `data_providers` and the
`(provider_id, external_id)` pair on sourced entities should ever need to
know the shape of a specific external API.

## Decision

```sql
-- Tracks which external system produced a given row's external_id.
-- Every provider-sourced entity below carries (provider_id, external_id),
-- never assumes there's exactly one provider, and never reuses a
-- provider's ID as this system's primary key.
CREATE TABLE data_providers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,        -- e.g. 'api-football'
    name        text NOT NULL,
    base_url    text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sports (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code  text NOT NULL UNIQUE,               -- 'football'
    name  text NOT NULL
);

CREATE TABLE leagues (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id   uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    label       text NOT NULL,                -- '2025/2026'
    start_date  date,
    end_date    date,
    is_current  boolean NOT NULL DEFAULT false,
    UNIQUE (league_id, label)
);
CREATE INDEX idx_seasons_league_current ON seasons(league_id) WHERE is_current;

CREATE TABLE teams (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
-- The two indexes that matter for actual page loads:
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
    -- Deterministic ordering key derived from provider data (minute, type,
    -- team, player) at mapping time — see change-detection.md. This is what
    -- makes re-ingesting the same provider event idempotent: the same
    -- input always produces the same sequence_number, so a redelivered
    -- Kafka message or a re-poll upserts instead of duplicating.
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
    -- One current snapshot per (match, team) — not a time series. A
    -- match_statistics_history table is a documented future extension for
    -- stat-trend-over-time analysis, not needed for the current UI.
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
```

### Transactional boundaries

- A single ingestion write (one polled match's changes) writes `matches`,
  any new `match_events`, and `match_statistics` inside **one transaction**.
  Either the whole poll result for that match lands durably, or none of it
  does — there's no partial state where a goal event exists but the score
  on `matches` doesn't reflect it yet.
- Kafka/Streams publish happens **after** the transaction commits, not
  inside it — the durable write is never rolled back because a broker call
  failed (this is also why idempotent consumers matter: a publish can
  succeed after a crash before the offset commits, causing redelivery).

### Timestamps and constraints

Every table uses `timestamptz`, never naive timestamps (matches kick off
across timezones). `UNIQUE(provider_id, external_id)` on every sourced
entity is the actual mechanism that makes the provider abstraction (ADR-007)
real at the database level, not just at the TypeScript interface level —
swapping providers means a new `data_providers` row and new external IDs,
never a schema change.

## Consequences

**Positive**
- Foreign keys + `CHECK` constraints (e.g. `home_team_id <> away_team_id`)
  catch malformed provider data at the database boundary, not three layers
  later in a UI bug report.
- `(provider_id, external_id)` uniqueness is what actually enables running
  two providers side by side later (e.g. API-Football for live data,
  football-data.org for historical backfill) without ID collisions.

**Negative / accepted constraints**
- `match_statistics` as a single current-snapshot row (not time-series)
  means no "possession over time" chart is possible without a schema
  addition later — acceptable now, documented as the first schema migration
  this project would need if that feature were requested.
- No table partitioning (e.g. by season) — unnecessary at portfolio data
  volume; noted in [scalability.md](../scalability.md) as a Production Mode
  concern once historical data spans many seasons.
