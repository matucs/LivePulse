/**
 * Real integration test — a real http.Server + WebSocketGateway + real
 * Postgres/Redis (docker compose up), real `ws` client connections. This
 * automates the manual validation done during Phase 5 development: connect
 * → subscribe → snapshot, fan-out to multiple local clients from one Redis
 * publish (what a Kafka consumer does after processing a domain event),
 * and unsubscribe actually stopping delivery — see
 * docs/adr/ADR-006-websocket-architecture.md.
 */
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool, withTransaction } from "../../src/db/client.js";
import { redis } from "../../src/cache/redisClient.js";
import { WebSocketGateway } from "../../src/ws/gateway.js";
import { ingestFixture } from "../../src/ingestion/ingestionService.js";
import { mapFixture } from "../../src/providers/mappers/fixtureMapper.js";
import { cacheKeys } from "../../src/cache/keys.js";
import { env } from "../../src/config/env.js";
import fixtureRaw from "../fixtures/fixture-live.json" with { type: "json" };
import eventsRaw from "../fixtures/events.json" with { type: "json" };
import statisticsRaw from "../fixtures/statistics.json" with { type: "json" };
import type { ApiFootballEvent, ApiFootballFixture, ApiFootballStatistics } from "../../src/providers/mappers/apiFootballTypes.js";

const fixture = fixtureRaw as ApiFootballFixture;
const events = eventsRaw as ApiFootballEvent[];
const statistics = statisticsRaw as ApiFootballStatistics[];
const mapped = mapFixture(fixture, events, statistics);
const TEST_PORT = 4099;

let httpServer: Server;
let gateway: WebSocketGateway;
const openSockets: WebSocket[] = [];

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    openSockets.push(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
  });
}

async function cleanDatabase(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("TRUNCATE match_events, match_statistics, standings, matches, seasons, teams, leagues RESTART IDENTITY CASCADE");
  });
}

describe("WebSocketGateway — real server, real Postgres/Redis", () => {
  beforeAll(async () => {
    await cleanDatabase();
    await ingestFixture({ pool, redis }, mapped);

    httpServer = createServer();
    gateway = new WebSocketGateway(httpServer, pool, redis, env.REDIS_URL);
    gateway.start();
    await new Promise<void>((resolve) => httpServer.listen(TEST_PORT, resolve));
  });

  afterEach(() => {
    for (const ws of openSockets.splice(0)) ws.close();
  });

  afterAll(async () => {
    await gateway.stop();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await redis.del(cacheKeys.liveMatch(mapped.match.id));
    await redis.zrem(cacheKeys.liveMatches(), mapped.match.id);
  });

  it("sends a match:snapshot with real data immediately on subscribe", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "subscribe", matchId: mapped.match.id }));

    const snapshot = await nextMessage(ws);
    expect(snapshot.type).toBe("match:snapshot");
    expect((snapshot.data as { match: { id: string } }).match.id).toBe(mapped.match.id);
  });

  it("responds with a MATCH_NOT_FOUND error for an unknown (but well-formed) matchId, without crashing", async () => {
    const ws = await connect();
    const fakeId = "00000000-0000-0000-0000-000000000000";
    ws.send(JSON.stringify({ type: "subscribe", matchId: fakeId }));

    const response = await nextMessage(ws);
    expect(response).toMatchObject({ type: "error", code: "MATCH_NOT_FOUND" });
  });

  it("fans a single Redis publish out to every local client subscribed to that match", async () => {
    const [wsA, wsB] = await Promise.all([connect(), connect()]);
    wsA.send(JSON.stringify({ type: "subscribe", matchId: mapped.match.id }));
    wsB.send(JSON.stringify({ type: "subscribe", matchId: mapped.match.id }));
    await Promise.all([nextMessage(wsA), nextMessage(wsB)]); // consume both snapshots

    const updateA = nextMessage(wsA);
    const updateB = nextMessage(wsB);
    // This is exactly what scoresConsumer.ts does after processing a real
    // Kafka message (docs/adr/ADR-003's Phase 4 addendum) — publishing here
    // directly is what proves the gateway's relay, independent of Kafka.
    await redis.publish(
      cacheKeys.wsMatchChannel(mapped.match.id),
      JSON.stringify({ type: "match:update", matchId: mapped.match.id, eventType: "MATCH_SCORE_CHANGED", data: { homeScore: 9, awayScore: 9 } }),
    );

    const [a, b] = await Promise.all([updateA, updateB]);
    expect(a).toMatchObject({ type: "match:update", matchId: mapped.match.id });
    expect(b).toMatchObject({ type: "match:update", matchId: mapped.match.id });
  });

  it("stops delivering to a client after it unsubscribes", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "subscribe", matchId: mapped.match.id }));
    await nextMessage(ws); // snapshot

    ws.send(JSON.stringify({ type: "unsubscribe", matchId: mapped.match.id }));
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the unsubscribe (and Redis UNSUBSCRIBE) land

    let received = false;
    ws.once("message", () => {
      received = true;
    });
    await redis.publish(
      cacheKeys.wsMatchChannel(mapped.match.id),
      JSON.stringify({ type: "match:update", matchId: mapped.match.id, data: {} }),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toBe(false);
  });

  it("replies to an app-level ping with pong", async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: "ping" }));
    const response = await nextMessage(ws);
    expect(response).toEqual({ type: "pong" });
  });
});
