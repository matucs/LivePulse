import type { MappedFixture, Standing } from "../domain/types.js";

/**
 * docs/adr/ADR-007-provider-abstraction.md — the application depends on
 * this, never on a specific provider's client or response shapes.
 */
export interface SportsDataProvider {
  /** Every currently live match worldwide, in one batched call (ADR-002). */
  getLiveMatches(): Promise<MappedFixture[]>;

  getFixturesByLeague(leagueExternalId: string, from: Date, to: Date): Promise<MappedFixture[]>;

  getMatch(externalId: string): Promise<MappedFixture>;

  getStandings(leagueExternalId: string, seasonYear: number): Promise<Standing[]>;
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
