import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, NonRetryableError, RetryExhaustedError, withRetry } from "../../../src/utils/retry.js";

describe("withRetry", () => {
  it("propagates a NonRetryableError as itself, without wrapping, on the very first attempt", async () => {
    class PermanentError extends NonRetryableError {}
    const fn = vi.fn().mockRejectedValue(new PermanentError("nope"));

    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toBeInstanceOf(PermanentError);
    // The bug this test guards: a NonRetryableError used to get silently
    // wrapped in RetryExhaustedError, which erased its type for callers
    // doing `instanceof` checks (see docs/adr/ADR-002 addendum) — and it
    // must only be attempted once, never retried.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and returns the eventual success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("wraps a genuinely exhausted retry sequence in RetryExhaustedError, preserving the cause", async () => {
    const cause = new Error("still failing");
    const fn = vi.fn().mockRejectedValue(cause);

    const err = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect((err as RetryExhaustedError).cause).toBe(cause);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and refuses calls during cooldown", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10_000 });

    expect(breaker.canProceed()).toBe(true);
    breaker.onFailure();
    expect(breaker.canProceed()).toBe(true); // still under threshold
    breaker.onFailure();
    expect(breaker.canProceed()).toBe(false); // threshold hit — open
  });

  it("resets the failure count on success", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    breaker.onFailure();
    breaker.onSuccess();
    breaker.onFailure();
    expect(breaker.canProceed()).toBe(true); // only one consecutive failure since reset
  });
});
