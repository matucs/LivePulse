/**
 * Exponential backoff with jitter, and a small circuit breaker.
 * See docs/adr/ADR-002-polling-strategy.md for the policy this implements.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Called with the attempt number (1-indexed) before each retry sleep. */
  onRetry?: (attempt: number, error: unknown) => void;
}

export class RetryExhaustedError extends Error {
  constructor(public readonly attempts: number, public readonly cause: unknown) {
    super(`Retry exhausted after ${attempts} attempts`);
    this.name = "RetryExhaustedError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(delay: number): number {
  const spread = delay * 0.2;
  return delay + (Math.random() * 2 - 1) * spread;
}

/**
 * Retries `fn` with exponential backoff. Does NOT retry when `fn` throws a
 * `NonRetryableError` (used for 429s — ADR-002 says retrying into a rate
 * limit only makes it worse; that path goes to the circuit breaker instead).
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 2000, maxDelayMs = 60_000, onRetry } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      // A NonRetryableError (429s, ProviderQueryRejectedError, ...) means
      // "don't retry this," not "we tried and ran out of attempts" — it
      // must propagate as itself so callers can `instanceof`-check it
      // specifically. Wrapping it in RetryExhaustedError here (as this
      // function used to do unconditionally) silently erased that type on
      // the very first attempt, which is what let a plan-restriction
      // rejection masquerade as a generic exhausted-retries failure
      // upstream (see docs/adr/ADR-002 addendum).
      if (err instanceof NonRetryableError) {
        throw err;
      }
      lastError = err;
      if (attempt === maxAttempts) {
        break;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      onRetry?.(attempt, err);
      await sleep(jitter(delay));
    }
  }
  throw new RetryExhaustedError(maxAttempts, lastError);
}

export class NonRetryableError extends Error {}

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

/**
 * Minimal circuit breaker: opens after N consecutive failures, refuses
 * calls during cooldown, allows exactly one trial call when half-open.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly opts: CircuitBreakerOptions = {}) {}

  private get failureThreshold(): number {
    return this.opts.failureThreshold ?? 3;
  }

  private get cooldownMs(): number {
    return this.opts.cooldownMs ?? 5 * 60_000;
  }

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open";
    }
    return this.state;
  }

  canProceed(): boolean {
    return this.getState() !== "open";
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.getState() === "half-open" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
      this.consecutiveFailures = 0;
    }
  }
}
