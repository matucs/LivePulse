# ADR-001: Sports Data API Selection

**Status:** Accepted
**Date:** 2026-09-06
**Deciders:** Project owner (portfolio author)
**Related:** [Full comparison research](../research/sports-api-comparison.md), ADR-002 (polling strategy), ADR-007 (provider abstraction), ADR-008 (free deployment)

## Context

LivePulse needs a real, currently-operating sports data source that provides
actual live match data (scores, events, statistics) — not a fixtures-only or
delayed feed — while running at €0/month. The provider must also publish
verifiable terms of service and rate-limit behavior, since the project must
document (not assume) both.

Four realistic providers and one class of "free/unlimited" aggregator sites
were evaluated as of September 2026: API-Football, football-data.org,
TheSportsDB, Sportmonks, and unofficial aggregators. Full detail in the
[comparison research doc](../research/sports-api-comparison.md).

## Decision

**Use API-Football (api-sports.io) as the primary sports data provider**,
accessed directly (not via RapidAPI), on its free tier (100 requests/day,
10 requests/minute).

It is the only evaluated provider that provides genuine live in-play data
(scores, events, lineups, statistics) at zero cost, publishes explicit
rate-limit headers on every response (`x-ratelimit-requests-limit`,
`x-ratelimit-requests-remaining`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`),
and covers enough competitions (1,236 leagues/cups) to populate a real "popular
leagues" home page.

It will be implemented as `ApiFootballProvider`, one concrete implementation
of the `SportsDataProvider` interface (ADR-007), so it can be swapped or
supplemented without touching ingestion, domain modeling, Kafka, or the
frontend.

## Alternatives considered

| Provider | Rejected because |
|---|---|
| football-data.org | Free tier has no live data at all — scores/schedules are explicitly delayed; live scores require a paid tier |
| TheSportsDB | Live (2-min) scores and the V2 API require the $9/mo Patreon tier; free tier is non-commercial only |
| Sportmonks | Free tier is a 2-league evaluation sandbox (Danish Superliga, Scottish Premiership); live scores are a paid add-on regardless of plan |
| Unofficial "unlimited free" aggregators | No verifiable ToS or rate-limit contract; risk of silently re-scraping a licensed provider and of disappearing without notice |

## Consequences

**Positive**
- Real live data is available for the core feature (live match page) from day one, at €0/month.
- Documented rate-limit headers make the quota manager (§8) a real, testable component instead of a guess-based throttle.
- Broad league coverage supports a credible home page without paying for it.

**Negative / accepted constraints**
- 100 requests/day is small. This forces the entire polling and change-detection design (ADR-002) to be efficient and intentional rather than naive — the project treats this as a feature to demonstrate (engineering judgment under real constraints), not a limitation to hide.
- API-Football's terms do not grant commercial rights on competition data. LivePulse must remain, and must visibly present itself as, a non-commercial engineering portfolio demo. If LivePulse ever became a real commercial product, this decision would need to be revisited (see below).
- Provider risk (pricing changes, shutdown, ToS changes) is real for any single external dependency. Mitigated structurally by the provider abstraction (ADR-007) rather than by trusting the provider won't change.

## Revisit triggers

Re-open this decision if any of the following happen:
- API-Football's free tier daily quota drops further or the ToS materially changes.
- LivePulse moves from portfolio to an actual commercial product — at that point, a licensed tier (API-Football paid, or Sportmonks, which has stronger commercial live-data plans) should be evaluated against real projected traffic.
- A second provider is added for redundancy or for data API-Football doesn't cover well (e.g. football-data.org for clean historical standings/results backfill, TheSportsDB for team badges/logos — both non-live, non-commercial uses that don't conflict with their respective terms).
