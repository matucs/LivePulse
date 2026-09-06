import type { MappedFixture } from "../domain/types.js";
import { NonRetryableError } from "../utils/retry.js";

/**
 * A provider permanently rejected this specific query — e.g. a plan/tier
 * restriction (API-Football's free tier rejects season-scoped
 * fixture/standings queries outside a historical window; discovered during
 * Phase 3 real-key validation, see the ADR-002 addendum). Provider-agnostic
 * on purpose: any `SportsDataProvider` implementation can throw this, and
 * callers (ingestion) handle it the same way regardless of which provider
 * is behind the interface (ADR-007) — logged once as a known, permanent
 * condition rather than treated as a transient failure.
 *
 * Extends `NonRetryableError` (a generic, provider-agnostic utility marker,
 * not an API-Football concept) so `withRetry` skips retrying it too:
 * retrying a plan-restriction rejection can never succeed.
 */
export class ProviderQueryRejectedError extends NonRetryableError {
  constructor(public readonly path: string, public readonly reasons: Record<string, string>) {
    super(`Provider rejected "${path}": ${JSON.stringify(reasons)}`);
    this.name = "ProviderQueryRejectedError";
  }
}

/**
 * docs/adr/ADR-007-provider-abstraction.md — the application depends on
 * this, never on a specific provider's client or response shapes.
 */
export interface SportsDataProvider {
  /** Every currently live match worldwide, in one batched call (ADR-002). */
  getLiveMatches(): Promise<MappedFixture[]>;

  getFixturesByLeague(leagueExternalId: string, seasonYear: number, from: Date, to: Date): Promise<MappedFixture[]>;

  getMatch(externalId: string): Promise<MappedFixture>;

  // No getStandings() — API-Football's free tier rejects every
  // current-season standings query outright (ADR-002 addendum), so it's
  // not part of this interface's contract. Standings come from
  // FootballDataProvider instead (ADR-007 addendum), a distinct, narrower
  // provider — not a SportsDataProvider implementation.
}

/** Carried alongside a provider response so the Quota Manager (ADR-002) can record it. */
export interface RateLimitInfo {
  dailyLimit?: number;
  dailyRemaining?: number;
  minuteLimit?: number;
  minuteRemaining?: number;
}

export interface ProviderResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
}
