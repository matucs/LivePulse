import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDlqHandling } from "../../../src/events/consumerRuntime.js";
import { dlqTopic, Topics } from "../../../src/events/topics.js";
import type { EventBus } from "../../../src/events/EventBus.js";

function fakeBus(): EventBus & { published: Array<{ topic: string; key: string; payload: unknown }> } {
  const published: Array<{ topic: string; key: string; payload: unknown }> = [];
  return {
    published,
    publish: vi.fn(async (topic, key, payload) => {
      published.push({ topic, key, payload });
    }),
    subscribe: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

const envelope = { eventId: "evt-1", eventType: "MATCH_SCORE_CHANGED", occurredAt: "now", matchId: "match-1", payload: {} };

describe("withDlqHandling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not retry or hit the DLQ when the handler succeeds first try", async () => {
    const bus = fakeBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withDlqHandling(bus, Topics.MatchScoreChanged, handler);

    await wrapped(envelope, { key: "match-1" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.published).toHaveLength(0);
  });

  it("retries a failing handler up to maxAttempts, then succeeds without hitting the DLQ", async () => {
    const bus = fakeBus();
    const handler = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(undefined);
    const wrapped = withDlqHandling(bus, Topics.MatchScoreChanged, handler, 3);

    const resultPromise = wrapped(envelope, { key: "match-1" });
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(handler).toHaveBeenCalledTimes(2);
    expect(bus.published).toHaveLength(0);
  });

  it("publishes to <topic>.dlq after exhausting retries, and does not rethrow (a poison message must not block the partition)", async () => {
    const bus = fakeBus();
    const handler = vi.fn().mockRejectedValue(new Error("permanently broken"));
    const wrapped = withDlqHandling(bus, Topics.MatchScoreChanged, handler, 3);

    const resultPromise = wrapped(envelope, { key: "match-1" });
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.topic).toBe(dlqTopic(Topics.MatchScoreChanged));
    expect(bus.published[0]?.key).toBe("match-1");
    expect(bus.published[0]?.payload).toMatchObject({
      originalTopic: Topics.MatchScoreChanged,
      retryCount: 3,
      error: expect.stringContaining("permanently broken"),
    });
  });
});
