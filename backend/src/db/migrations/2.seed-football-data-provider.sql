-- docs/adr/ADR-007 addendum: football-data.org supplies standings only
-- (API-Football's free tier can't supply current-season standings at all —
-- ADR-002 addendum). When a football-data.org team can't be reconciled by
-- name to an existing API-Football-sourced team (domain/teamNameMatch.ts —
-- typically because that league hasn't had a live match yet this session,
-- so the team simply doesn't exist in `teams` yet), a team row is created
-- under THIS provider rather than silently dropping the standings row.
-- This is real, honestly-attributed data, not a guess — the `provider_id`
-- join always shows exactly which system supplied a given team row.
INSERT INTO data_providers (code, name, base_url)
VALUES ('football-data', 'football-data.org', 'https://api.football-data.org/v4')
ON CONFLICT (code) DO NOTHING;
