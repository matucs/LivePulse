import type { MappedFixture } from "../domain/types.js";
import { ProviderQueryRejectedError, type ProviderResponse, type RateLimitInfo, type SportsDataProvider } from "./SportsDataProvider.js";
import type {
  ApiFootballBaseResponse,
  ApiFootballEventsResponse,
  ApiFootballFixturesResponse,
  ApiFootballStatisticsResponse,
} from "./mappers/apiFootballTypes.js";
import { mapFixture } from "./mappers/fixtureMapper.js";
import { CircuitBreaker, NonRetryableError, withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";
import { providerRequestDuration, providerRequestErrors } from "../observability/metrics.js";

const PROVIDER_LABEL = "api-football";

/** API-Football's `errors` field is `[]`/`{}` when empty — both mean "no errors". */
function extractPlanErrors(errors: Record<string, string> | unknown[]): Record<string, string> | null {
  if (Array.isArray(errors)) return null;
  const keys = Object.keys(errors);
  return keys.length ? errors : null;
}

function classifyError(err: unknown): string {
  if (err instanceof ProviderQueryRejectedError) return "plan_rejected";
  if (err instanceof Error && err.name === "AbortError") return "timeout";
  if (err instanceof Error && err.message.includes("rate limit")) return "rate_limited";
  if (err instanceof Error && err.message.includes("request failed")) return "http_error";
  return "other";
}

export interface ApiFootballProviderOptions {
  apiKey: string;
  baseUrl: string;
  /** Called after every response (success or failure) with whatever rate-limit info was present. */
  onRateLimit?: (info: RateLimitInfo) => void;
  timeoutMs?: number;
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const num = (name: string): number | undefined => {
    const v = headers.get(name);
    return v !== null ? Number(v) : undefined;
  };
  return {
    dailyLimit: num("x-ratelimit-requests-limit"),
    dailyRemaining: num("x-ratelimit-requests-remaining"),
    minuteLimit: num("x-ratelimit-limit"),
    minuteRemaining: num("x-ratelimit-remaining"),
  };
}

/**
 * docs/adr/ADR-007 — the only class in the codebase allowed to know
 * API-Football's URLs, headers, and JSON shapes. Everything it returns is
 * already mapped to the internal domain model (docs/data-provider.md).
 */
export class ApiFootballProvider implements SportsDataProvider {
  private readonly breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 5 * 60_000 });

  constructor(private readonly opts: ApiFootballProviderOptions) {}

  private async request<T extends ApiFootballBaseResponse>(path: string): Promise<ProviderResponse<T>> {
    if (!this.breaker.canProceed()) {
      throw new Error(`Circuit breaker open for API-Football — skipping request to ${path}`);
    }

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 8000);
        const startedAt = process.hrtime.bigint();
        const observeDuration = (outcome: "success" | "failure"): void => {
          const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
          providerRequestDuration.observe({ provider: PROVIDER_LABEL, outcome }, seconds);
        };
        try {
          const res = await fetch(`${this.opts.baseUrl}${path}`, {
            headers: { "x-apisports-key": this.opts.apiKey },
            signal: controller.signal,
          });
          const rateLimit = parseRateLimitHeaders(res.headers);
          this.opts.onRateLimit?.(rateLimit);

          if (res.status === 429) {
            this.breaker.onFailure();
            throw new NonRetryableError(`API-Football rate limit hit (429) on ${path}`);
          }
          if (!res.ok) {
            throw new Error(`API-Football request failed: ${res.status} ${res.statusText} on ${path}`);
          }

          const data = (await res.json()) as T;
          // The HTTP round-trip succeeded (key valid, connectivity fine) —
          // that's what the breaker tracks, so onSuccess() fires regardless
          // of a plan-restriction rejection below (see ProviderQueryRejectedError).
          this.breaker.onSuccess();

          const planErrors = extractPlanErrors(data.errors);
          if (planErrors) {
            throw new ProviderQueryRejectedError(path, planErrors);
          }

          observeDuration("success");
          return { data, rateLimit };
        } catch (err) {
          // Single point of failure-observation (duration + error
          // classification) — deliberately not duplicated inline at each
          // throw site above, which would risk double-counting the same
          // failure once inline and once here.
          observeDuration("failure");
          providerRequestErrors.inc({ provider: PROVIDER_LABEL, error_type: classifyError(err) });
          throw err;
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        onRetry: (attempt, err) => {
          this.breaker.onFailure();
          logger.warn({ attempt, path, err: String(err) }, "Retrying API-Football request");
        },
      },
    );
  }

  /** GET /fixtures?live=all — every live match worldwide, one request regardless of count (ADR-002). */
  async getLiveMatches(): Promise<MappedFixture[]> {
    const { data } = await this.request<ApiFootballFixturesResponse>("/fixtures?live=all");
    return data.response.map((f) => mapFixture(f));
  }

  async getFixturesByLeague(
    leagueExternalId: string,
    seasonYear: number,
    from: Date,
    to: Date,
  ): Promise<MappedFixture[]> {
    // `season` is required by API-Football, not optional (its absence
    // previously produced a *different* error than the plan restriction
    // below and masked it — see the ADR-002 addendum).
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    const { data } = await this.request<ApiFootballFixturesResponse>(
      `/fixtures?league=${leagueExternalId}&season=${seasonYear}&from=${fromStr}&to=${toStr}`,
    );
    return data.response.map((f) => mapFixture(f));
  }

  async getMatch(externalId: string): Promise<MappedFixture> {
    const [{ data: fixtureData }, events, statistics] = await Promise.all([
      this.request<ApiFootballFixturesResponse>(`/fixtures?id=${externalId}`),
      this.request<ApiFootballEventsResponse>(`/fixtures/events?fixture=${externalId}`).then((r) => r.data.response),
      this.request<ApiFootballStatisticsResponse>(`/fixtures/statistics?fixture=${externalId}`).then(
        (r) => r.data.response,
      ),
    ]);
    const fixture = fixtureData.response[0];
    if (!fixture) {
      throw new Error(`No fixture found for external id ${externalId}`);
    }
    return mapFixture(fixture, events, statistics);
  }

  // No getStandings() here (removed from SportsDataProvider too) — every
  // season-scoped query, standings included, is rejected outright on the
  // free tier (ADR-002 addendum). FootballDataProvider supplies standings
  // instead (ADR-007 addendum); keeping a method here that can never
  // succeed would be dead, misleading surface area.
}
