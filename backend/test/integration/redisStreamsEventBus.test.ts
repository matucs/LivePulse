/**
 * Real integration test — real Redis (docker compose), real XADD/
 * XREADGROUP/XACK, no mocks. This is the Portfolio Mode production event
 * transport (docs/adr/ADR-008) and had zero test coverage before this —
 * a real gap: a bug here wouldn't surface until an actual €0/month
 * deployment was already relying on it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { RedisStreamsEventBus } from "../../src/events/RedisStreamsEventBus.js";
import { env } from "../../src/config/env.js";
import type { EventEnvelope } from "../../src/events/EventBus.js";

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(check, 50);
    };
    check();
  });
}

describe("RedisStreamsEventBus — real Redis", () => {
  const buses: RedisStreamsEventBus[] = [];
  const testTopic = `test.stream.${Date.now()}`;

  function makeBus(): RedisStreamsEventBus {
    const bus = new RedisStreamsEventBus({ redisUrl: env.REDIS_URL });
    buses.push(bus);
    return bus;
  }

  afterEach(async () => {
    await Promise.all(buses.splice(0).map((b) => b.stop()));
    const cleanup = new Redis(env.REDIS_URL);
    await cleanup.del(testTopic).catch(() => {});
    await cleanup.quit();
  });

  it("delivers a published message to a subscribed handler", async () => {
    const bus = makeBus();
    await bus.start();

    const received: Array<{ envelope: EventEnvelope; key: string }> = [];
    await bus.subscribe(testTopic, "test-group-1", async (envelope, raw) => {
      received.push({ envelope, key: raw.key });
    });

    await bus.publish(testTopic, "match-1", { matchId: "match-1", homeScore: 1 }, "MATCH_SCORE_CHANGED");

    await waitFor(() => received.length > 0);
    expect(received[0]?.key).toBe("match-1");
    expect(received[0]?.envelope.eventType).toBe("MATCH_SCORE_CHANGED");
    expect(received[0]?.envelope.payload).toMatchObject({ matchId: "match-1", homeScore: 1 });
  });

  it("acks messages after successful processing (no pending entries left)", async () => {
    const bus = makeBus();
    await bus.start();
    let processed = false;
    await bus.subscribe(testTopic, "test-group-ack", async () => {
      processed = true;
    });

    await bus.publish(testTopic, "match-2", { matchId: "match-2" }, "MATCH_UPDATED");
    await waitFor(() => processed);
    await new Promise((r) => setTimeout(r, 100)); // let the XACK in the finally block land

    const check = new Redis(env.REDIS_URL);
    const pending = (await check.xpending(testTopic, "test-group-ack")) as unknown[];
    await check.quit();
    expect(pending[0]).toBe(0); // pending-count is the first element of XPENDING's summary form
  });

  it("still acks when the handler throws — DLQ/retry is consumerRuntime's job, not this bus's", async () => {
    const bus = makeBus();
    await bus.start();
    let attempts = 0;
    await bus.subscribe(testTopic, "test-group-throw", async () => {
      attempts += 1;
      throw new Error("handler failure");
    });

    await bus.publish(testTopic, "match-3", { matchId: "match-3" }, "MATCH_UPDATED");
    await waitFor(() => attempts >= 1);
    await new Promise((r) => setTimeout(r, 300)); // give a redelivery a chance to happen if acking had been skipped

    // If the message were left unacked, XREADGROUP's ">" cursor wouldn't
    // redeliver it either (that only happens via XCLAIM/pending-retry,
    // which this bus doesn't do) — the real risk being guarded against
    // here is a permanently-growing pending list, not redelivery. Confirm
    // exactly one attempt happened and nothing is stuck pending.
    const check = new Redis(env.REDIS_URL);
    const pending = (await check.xpending(testTopic, "test-group-throw")) as unknown[];
    await check.quit();
    expect(attempts).toBe(1);
    expect(pending[0]).toBe(0);
  });

  it("creating the same consumer group twice does not throw (BUSYGROUP handled)", async () => {
    const bus = makeBus();
    await bus.start();
    await bus.subscribe(testTopic, "test-group-dup", async () => {});
    await expect(bus.subscribe(testTopic, "test-group-dup", async () => {})).resolves.toBeUndefined();
  });
});
