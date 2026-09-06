# Data Provider Layer

Reference doc for the `SportsDataProvider` interface and its implementation.
Decision rationale is in [ADR-007](adr/ADR-007-provider-abstraction.md);
provider selection rationale is in [ADR-001](adr/ADR-001-sports-api-selection.md).

## Interface

```typescript
interface SportsDataProvider {
  getLiveMatches(): Promise<Match[]>;
  getMatch(externalId: string): Promise<Match>;
  getMatchEvents(externalId: string): Promise<MatchEvent[]>;
  getMatchStatistics(externalId: string): Promise<MatchStatistics[]>;
  getStandings(leagueExternalId: string, seasonLabel: string): Promise<Standing[]>;
  getFixtures(leagueExternalId: string, from: Date, to: Date): Promise<Match[]>;
}
```

`Match`, `MatchEvent`, `MatchStatistics`, `Standing` are the internal domain
types ([architecture.md §3](architecture.md#3-domain-model)) — this
interface never returns a provider's raw response shape.

## `ApiFootballProvider`

The only concrete implementation today. Responsibilities:

1. **HTTP client** — base URL, API key from `API_FOOTBALL_KEY` env var
   (never sent to the browser, §24), timeout (default 8s, ADR-002).
2. **Rate-limit header capture** — every response's
   `x-ratelimit-requests-limit` / `x-ratelimit-requests-remaining` /
   `X-RateLimit-Limit` / `X-RateLimit-Remaining` are extracted and handed to
   the Quota Manager (ADR-002) regardless of which method was called.
3. **Mapping** — API-Football's fixture/event/statistics JSON shapes are
   mapped to `Match`/`MatchEvent`/`MatchStatistics`/`Standing`. This is
   where:
   - `provider_id` is set to the `data_providers` row for `api-football`.
   - `external_id` is API-Football's fixture/team/league ID, kept as an
     opaque string — nothing downstream parses or assumes its format.
   - `MatchEvent.sequence_number` is derived deterministically from
     `(minute, extra_minute, type, team_external_id, player_external_id)` —
     same input always produces the same number, which is what makes
     re-ingesting the same event idempotent (ADR-005,
     [change-detection.md](change-detection.md)).
4. **Batched live fetch** — `getLiveMatches()` calls `GET /fixtures?live=all`
   once and returns every mapped live match; it does not make one request
   per match (ADR-002 — this is the fact that makes the free tier workable
   at all).

## Endpoints used (API-Football v3)

| Method | Endpoint | Called by |
|---|---|---|
| `getLiveMatches` | `GET /fixtures?live=all` | Live polling tier |
| `getFixtures` | `GET /fixtures?league={id}&season={year}&from=&to=` | Upcoming/pre-match polling tier |
| `getMatch` | `GET /fixtures?id={id}` | On-demand refresh (e.g. cache miss) |
| `getMatchEvents` | `GET /fixtures/events?fixture={id}` | Included in live poll response where available; called standalone on cache miss |
| `getMatchStatistics` | `GET /fixtures/statistics?fixture={id}` | Live polling tier, lower priority than score/events in the request budget |
| `getStandings` | `GET /standings?league={id}&season={year}` | Standings refresh tier |

## Adding a second provider

1. Insert a `data_providers` row (`code`, `name`, `base_url`).
2. Implement `SportsDataProvider` for it — own its HTTP client, its own
   rate-limit handling (if it has one), and its own mapping to the domain
   types.
3. Wire it into the provider factory behind config — either as the sole
   active provider, or (for non-live/supplementary data only, e.g. historical
   standings from football-data.org or badges from TheSportsDB) as a
   secondary source the ingestion service calls for specific fields.
4. Nothing in Kafka topics, Postgres schema, Redis keys, or the frontend
   needs to change — that's the point of ADR-007.

### `FootballDataProvider` — a real example of exactly this

Added after real-key validation showed API-Football's free tier can't
supply current-season standings at all (ADR-002 addendum). It does **not**
implement the full `SportsDataProvider` interface above — it was never a
live-match candidate (no live data on its free tier, ADR-001) — it's a
narrower, separate provider with one method (`getStandings`), used only by
the standings polling tier. See the
[ADR-007 addendum](adr/ADR-007-provider-abstraction.md#addendum-2026-09-06-a-second-provider-added--and-why-this-isnt-the-per-field-fallback-this-adr-said-it-wouldnt-build)
for the identity-reconciliation problem this raised (football-data.org's
team/league ids have no relationship to API-Football's) and how it's
solved — by name, not by id — in `domain/teamNameMatch.ts`.
