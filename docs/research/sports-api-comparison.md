# Sports Data Provider Research — Phase 1

**Status:** Complete
**Date:** 2026-09-06
**Author:** Architecture research for LivePulse

This document compares currently available sports data APIs against LivePulse's
actual requirements, as of September 2026. No application code depends on these
findings yet — this is the research gate required before Phase 2 (Architecture).

## 1. Requirements used to evaluate providers

LivePulse's core promise is a live match page that updates itself without a
refresh. That means a provider is only usable if it clears all of these bars
on a plan we can actually afford at launch (€0/month):

1. Provides **live, in-play scores and events** (not just fixtures/results) on the free tier.
2. Covers enough leagues to fill a believable "popular leagues" home page.
3. Exposes events (goals, cards, subs) and match statistics, not just the scoreline.
4. Publishes **documented, machine-readable rate limits** (so a real quota manager can be built against it, not guessed at).
5. Has terms of service compatible with a public, clearly-labeled, non-commercial portfolio demo.
6. Has been operating long enough / is well-known enough to be a reasonably safe bet against sudden shutdown.

## 2. Providers evaluated

### 2.1 API-Football (api-sports.io / api-football.com)

- **Free tier:** 100 requests/day, 10 requests/minute. No credit card required. "Always free" per provider messaging.
- **Coverage:** 1,236 leagues and cups.
- **Live data:** Yes — live scores, events (goals/cards/subs), lineups, and in-play statistics are all available on the free tier. Provider states live data updates roughly every 15 seconds, though lower-tier competitions can lag behind the real action.
- **Rate limit visibility:** Excellent. Every response carries both daily and per-minute headers:
  - `x-ratelimit-requests-limit` / `x-ratelimit-requests-remaining` (daily quota)
  - `X-RateLimit-Limit` / `X-RateLimit-Remaining` (per-minute quota)
  This is exactly the signal §8 of the spec asks the quota manager to track, with no guessing needed.
- **Terms of service:** API-Football does **not** grant commercial rights on the underlying competition data. Use for betting products, broadcast, or mass redistribution requires separate licensing from the rights holders, and the client is responsible for verifying authorization. A clearly labeled, non-commercial, portfolio/demo project displaying scores (the same category as thousands of hobbyist dashboards built on this API) is consistent with this — but it must **not** be marketed or monetized as a data resale product.
- **Longevity:** Long-running product (api-sports.io network), widely used, actively maintained documentation.

**Verdict: meets all 6 bars.** This is the only evaluated provider with real live in-play data, broad coverage, and transparent rate limits, all on a genuinely free tier.

### 2.2 football-data.org

- **Free tier:** 10 requests/minute, 12 competitions (Champions League, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Championship, Brasileirão, World Cup, Euros).
- **Live data:** **No.** Scores and schedules on the free tier are delayed, by the provider's own description — fine for historical dashboards, not for a "second-by-second live match" product.
- **Depth:** Lineups, substitutions, cards, and squad detail are paywalled even above the free tier; live scores are a separate paid add-on tier (Standard, €49/mo. and up).
- **Verdict: fails requirement #1 (no live data) outright.** Good provider for a historical/standings archive feature later, not as the primary live-data source. Recommended as a **future secondary provider** for enriched historical backfill only, behind the same `SportsDataProvider` interface.

### 2.3 TheSportsDB

- **Free tier (V1):** Broad, community-maintained (Wikipedia-style) database; historically generous but throttled over time due to abuse.
- **Live data:** 2-minute-interval livescores and the modern V2 API require the $9/month Patreon supporter tier.
- **Terms:** Free tier is explicitly **non-commercial**; commercial use of any kind requires the paid Patreon key.
- **Verdict:** Doesn't clear bar #1 for free, and bar #5 is a hard no if the project is even loosely commercial-adjacent later. Good candidate later for **team logos/badges and static reference metadata** (a non-commercial, non-live use), but not as the live-match provider, and not to be wired in until its terms are re-checked at that time.

### 2.4 Sportmonks

- **Free tier:** Evaluation-only — limited to the Danish Superliga and Scottish Premiership, two leagues total.
- **Live data:** Locked behind a paid add-on (from €12/mo on top of a base plan starting at €29/mo).
- **Verdict:** Excellent product (2,200+ leagues, xG, odds) but the free tier is a sales trial, not something a €0/month portfolio project can run on. Worth revisiting if this ever becomes a funded product (see ADR-001 "Revisit triggers").

### 2.5 Unofficial "free & unlimited" aggregators (e.g. bzzoiro-style sites)

- Several sites market themselves as free, unlimited alternatives to API-Football/Sportmonks with no rate limits.
- **Verdict: rejected.** No independently verifiable terms of service, no public rate-limit contract, and — per the project's own instruction not to assume an API is free/usable without checking current docs — no way to confirm they aren't quietly re-scraping a licensed provider (which would make our use of them a second-hand ToS violation) or liable to disappear without notice. Not a safe foundation for a platform meant to run continuously.

## 3. Recommendation

**Primary provider: API-Football**, accessed directly via api-sports.io (not through RapidAPI, to avoid an extra intermediary and extra latency), implemented as `ApiFootballProvider` behind the `SportsDataProvider` interface (see [ADR-007](../adr/ADR-007-provider-abstraction.md), Phase 2).

This is formalized in [ADR-001](../adr/ADR-001-sports-api-selection.md).

## 4. Consequence this has on architecture (forward pointer)

- 100 requests/day is a **hard, small budget** — this is why §7/§8 of the spec (intelligent polling + quota manager) are not optional nice-to-haves here, they are the only reason the product can function at all. Architecture must budget requests per matchday explicitly (see ADR-002, Phase 2).
- Because no always-on free hosted Kafka exists in 2026 (Upstash Kafka was discontinued in March 2025; Confluent Cloud's free offering is a promotional credit, not a permanent free tier), the public €0 deployment cannot run real Kafka continuously for free. This is handled by putting Kafka behind an `EventBus` interface with two implementations — real Kafka (Docker Compose, local/dev, and documented as the Production Mode transport) and Redis Streams (portfolio/public deployment) — rather than either skipping the event-driven design or dishonestly claiming Kafka runs in the free deployment. See ADR-003 and ADR-008 (Phase 2).
- The ToS boundary means the running app must carry a visible, honest attribution/disclaimer ("Data provided by API-Football — non-commercial demo") rather than presenting itself as a commercial data product.
