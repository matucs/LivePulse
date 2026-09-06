# ADR-007: Provider Abstraction

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [ADR-001](ADR-001-sports-api-selection.md), [data-provider.md](../data-provider.md)

## Context

§6 asks for a `SportsDataProvider` interface so API-Football isn't wired
directly into the application. It's worth being explicit about *why*,
because an abstraction with no real reason behind it is exactly the kind of
overengineering §6 also warns against.

The real reasons here, in order of actual importance:

1. **Provider risk is real, not hypothetical.** Every provider evaluated in
   ADR-001 has a plausible failure mode: API-Football could tighten its
   free tier, football-data.org's paid tier could become the only viable
   option, a provider could shut down. The interface is what makes that a
   config change instead of a rewrite.
2. **Different providers are already needed for different data.** ADR-001
   already flags football-data.org (clean historical standings) and
   TheSportsDB (team badges) as plausible *secondary* sources for
   non-live data. Two providers exist from day one in the design, even
   though only one is implemented now.
3. **It keeps the domain model honest.** Without this boundary, it's easy
   for API-Football's response shape to leak into `Match`/`MatchEvent` and
   quietly become the domain model. The interface forces a mapping step to
   exist, which is what makes ADR-005's schema provider-independent in
   practice, not just in intent.

## Decision

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
types from [architecture.md §3](../architecture.md#3-domain-model) — never
API-Football's response shapes. `ApiFootballProvider implements
SportsDataProvider` and owns all mapping from API-Football's JSON to these
types, including generating the deterministic `sequence_number` used for
`MatchEvent` idempotency (ADR-005, [change-detection.md](../change-detection.md)).

Provider selection is a single factory keyed by config
(`SPORTS_PROVIDER=api-football`), not a runtime plugin system — there is
exactly one production implementation today, and the interface exists so a
second one is a new class plus one line of factory wiring, not a rewrite of
ingestion, change detection, Kafka, or the frontend.

### What this deliberately does *not* do (avoiding overengineering, per §6)

- No generic plugin/registry system for providers that don't exist yet.
- No attempt to build a lowest-common-denominator interface across sports
  LivePulse doesn't support yet (§29) — the interface is football-shaped
  because that's the only sport implemented; extending to another sport is
  a documented future exercise (likely a second interface or generics),
  not something speculatively designed in now.
- No configuration for per-field provider fallback (e.g. "get score from
  API-Football but statistics from Sportmonks") — a provider is authoritative
  for a match as a whole. Mixing providers per-field is a real feature some
  products need, but nothing in this project's actual requirements calls
  for it, so it isn't built.

## Consequences

**Positive**
- ADR-001's revisit triggers (quota changes, provider shutdown, moving to a
  paid tier) become implementation swaps, not architecture changes.
- Testability: `SportsDataProvider` is trivially mockable for unit-testing
  ingestion, change detection, and event generation without hitting the
  real API or its rate limits (§25).

**Negative / accepted constraints**
- The interface's shape is still implicitly influenced by what API-Football
  can provide (e.g. `getMatchStatistics` assumes per-team stat snapshots,
  which is how most providers model it, but isn't guaranteed universal). If
  a future provider models something fundamentally differently, the
  interface may need to grow — accepted, since designing further ahead of
  a second real implementation would be speculation, not abstraction.
