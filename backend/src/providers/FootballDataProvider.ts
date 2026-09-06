import type { Standing } from "../domain/types.js";
import type { TeamCandidate } from "../domain/teamNameMatch.js";
import type { RateLimitInfo } from "./SportsDataProvider.js";
import { ProviderQueryRejectedError } from "./SportsDataProvider.js";
import type { FootballDataErrorResponse, FootballDataStandingsResponse } from "./mappers/footballDataTypes.js";
import { mapStandings } from "./mappers/footballDataMapper.js";
import { CircuitBreaker, NonRetryableError, withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

/**
 * Static mapping from API-Football's numeric league ids (what LivePulse's
 * TRACKED_LEAGUE_IDS and the rest of the schema use — ADR-005) to
 * football-data.org's competition codes. Hardcoded deliberately: only the
 * six leagues LivePulse tracks (§19 "limited number of leagues") need this,
 * so a general N-provider league-code reconciliation system would be
 * overengineering for what's actually needed (ADR-007's own stated
 * philosophy) — this is a config table, not an abstraction.
 */
export const API_FOOTBALL_TO_FOOTBALL_DATA_CODE: Record<string, string> = {
  "39": "PL", // Premier League
  "140": "PD", // La Liga (Primera Division)
  "135": "SA", // Serie A
  "78": "BL1", // Bundesliga
  "61": "FL1", // Ligue 1
  "2": "CL", // UEFA Champions League
};

export interface FootballDataProviderOptions {
  apiToken: string;
  baseUrl: string;
  onRateLimit?: (info: RateLimitInfo) => void;
  timeoutMs?: number;
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  // football-data.org publishes per-minute headroom only (no documented
  // daily cap the way API-Football does) — mapped onto the same
  // provider-agnostic RateLimitInfo shape (ADR-007) so QuotaManager doesn't
  // need to know which provider it's tracking.
  const minuteRemaining = headers.get("X-Requests-Available-Minute");
  return {
    minuteRemaining: minuteRemaining !== null ? Number(minuteRemaining) : undefined,
  };
}

/**
 * Supplies `Standing` rows only (docs/adr/ADR-007 addendum) — not a full
 * `SportsDataProvider`. football-data.org's free tier has no live scores at
 * all (ADR-001), so it was never a candidate to replace API-Football;
 * it exists purely to fill the one gap API-Football's free tier can't:
 * current-season standings (ADR-002 addendum).
 */
export class FootballDataProvider {
  private readonly breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5 * 60_000 });

  constructor(private readonly opts: FootballDataProviderOptions) {}

  /**
   * @param leagueExternalId API-Football's numeric league id (e.g. "39") —
   *   NOT football-data.org's own code. Resolved via
   *   API_FOOTBALL_TO_FOOTBALL_DATA_CODE so the returned standings attach
   *   to the season/team identity API-Football's match ingestion already
   *   established, not a new football-data.org-scoped identity.
   */
  async getStandings(leagueExternalId: string, seasonId: string, candidates: TeamCandidate[]): Promise<Standing[]> {
    const code = API_FOOTBALL_TO_FOOTBALL_DATA_CODE[leagueExternalId];
    if (!code) {
      throw new Error(`No football-data.org competition code mapped for league external id ${leagueExternalId}`);
    }

    if (!this.breaker.canProceed()) {
      throw new Error(`Circuit breaker open for football-data.org — skipping standings for ${code}`);
    }

    const { data } = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 8000);
        try {
          const res = await fetch(`${this.opts.baseUrl}/competitions/${code}/standings`, {
            headers: { "X-Auth-Token": this.opts.apiToken },
            signal: controller.signal,
          });
          const rateLimit = parseRateLimitHeaders(res.headers);
          this.opts.onRateLimit?.(rateLimit);

          if (res.status === 429) {
            this.breaker.onFailure();
            throw new NonRetryableError(`football-data.org rate limit hit (429) on competitions/${code}/standings`);
          }
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as Partial<FootballDataErrorResponse>;
            this.breaker.onFailure();
            throw new ProviderQueryRejectedError(`/competitions/${code}/standings`, {
              http_status: String(res.status),
              message: body.message ?? res.statusText,
            });
          }

          const json = (await res.json()) as FootballDataStandingsResponse;
          this.breaker.onSuccess();
          return { data: json, rateLimit };
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        onRetry: (attempt, err) => {
          this.breaker.onFailure();
          logger.warn({ attempt, code, err: String(err) }, "Retrying football-data.org request");
        },
      },
    );

    return mapStandings(data, seasonId, candidates);
  }
}
