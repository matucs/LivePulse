import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { Redis } from "ioredis";
import type { QueryClient } from "../db/client.js";
import { cacheKeys } from "../cache/keys.js";
import { buildMatchSnapshot } from "../api/matchSnapshot.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { websocketConnections, websocketMessages } from "../observability/metrics.js";

interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  matchId?: string;
}

/**
 * docs/websocket.md (protocol reference) + docs/adr/ADR-006 (design). One
 * gateway instance handles every connection in Portfolio Mode (ADR-008);
 * the design still scales horizontally (Production Mode) because fan-out
 * happens over Redis pub/sub, not in-process state any single instance
 * would need to share.
 *
 * Two Redis roles, deliberately separate connections (same reasoning as
 * RedisStreamsEventBus's dedicated subscriber connection): `reads` (the
 * app's shared client) serves cache-aside snapshot reads; `subscriberRedis`
 * is dedicated to pub/sub subscribe mode, dynamically SUBSCRIBE/UNSUBSCRIBE
 * as local client interest changes — never one Redis connection per match,
 * one connection total, N channels.
 */
export class WebSocketGateway {
  private readonly wss: WebSocketServer;
  private readonly subscriberRedis: Redis;
  private readonly channelSubscribers = new Map<string, Set<WebSocket>>(); // channel -> local sockets interested in it
  private readonly connectionSubscriptions = new Map<WebSocket, Set<string>>(); // socket -> matchIds it subscribed to
  private readonly ipConnectionCounts = new Map<string, number>();
  private readonly aliveFlags = new Map<WebSocket, boolean>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    server: Server,
    private readonly pool: QueryClient,
    private readonly reads: Redis,
    redisUrl: string,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.subscriberRedis = new Redis(redisUrl);
  }

  start(): void {
    this.subscriberRedis.on("message", (channel: string, message: string) => {
      const sockets = this.channelSubscribers.get(channel);
      if (!sockets) return;
      // Cheap type extraction for the metric label, not a full JSON.parse
      // per fan-out send — the consumers always put `type` first in the
      // object they publish (scoresConsumer.ts etc.), so this is reliable
      // in practice without paying parsing cost for every relayed message.
      const type = /"type":"([^"]+)"/.exec(message)?.[1] ?? "unknown";
      for (const ws of sockets) this.rawSend(ws, message, type);
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req.socket.remoteAddress ?? "unknown");
    });

    this.heartbeatTimer = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (this.aliveFlags.get(ws) === false) {
          ws.terminate(); // 'close' handler does the subscription/count cleanup
          continue;
        }
        this.aliveFlags.set(ws, false);
        ws.ping();
      }
    }, env.WS_HEARTBEAT_INTERVAL_MS);

    logger.info({ path: "/ws", maxConnections: env.WS_MAX_CONNECTIONS }, "WebSocket gateway started");
  }

  async stop(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await this.subscriberRedis.quit();
  }

  private handleConnection(ws: WebSocket, ip: string): void {
    if (this.wss.clients.size > env.WS_MAX_CONNECTIONS) {
      this.rawSend(ws, JSON.stringify({ type: "error", code: "GLOBAL_CONNECTION_LIMIT", message: "Server connection limit reached" }), "error");
      ws.close();
      return;
    }
    const ipCount = this.ipConnectionCounts.get(ip) ?? 0;
    if (ipCount >= env.WS_MAX_CONNECTIONS_PER_IP) {
      this.rawSend(ws, JSON.stringify({ type: "error", code: "IP_CONNECTION_LIMIT", message: "Too many connections from this IP" }), "error");
      ws.close();
      return;
    }
    this.ipConnectionCounts.set(ip, ipCount + 1);
    this.connectionSubscriptions.set(ws, new Set());
    this.aliveFlags.set(ws, true);
    websocketConnections.inc();

    ws.on("pong", () => this.aliveFlags.set(ws, true));
    ws.on("message", (raw) => void this.handleMessage(ws, raw));
    ws.on("close", () => void this.handleClose(ws, ip));
    ws.on("error", (err) => logger.warn({ err: String(err) }, "WebSocket connection error"));
  }

  private async handleMessage(ws: WebSocket, raw: RawData): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      websocketMessages.inc({ direction: "in", type: "invalid" });
      this.sendError(ws, "INVALID_MESSAGE", "Malformed JSON");
      return;
    }
    websocketMessages.inc({ direction: "in", type: msg.type ?? "unknown" });

    switch (msg.type) {
      case "subscribe":
        if (!msg.matchId) return this.sendError(ws, "INVALID_MESSAGE", "subscribe requires matchId");
        await this.handleSubscribe(ws, msg.matchId);
        return;
      case "unsubscribe":
        if (!msg.matchId) return this.sendError(ws, "INVALID_MESSAGE", "unsubscribe requires matchId");
        await this.handleUnsubscribe(ws, msg.matchId);
        return;
      case "ping":
        this.send(ws, { type: "pong" });
        return;
      default:
        this.sendError(ws, "UNKNOWN_MESSAGE_TYPE", `Unknown message type: ${String((msg as { type?: unknown }).type)}`);
    }
  }

  private async handleSubscribe(ws: WebSocket, matchId: string): Promise<void> {
    const subs = this.connectionSubscriptions.get(ws);
    if (!subs || subs.has(matchId)) return; // already subscribed — idempotent, not an error

    if (subs.size >= env.WS_MAX_SUBSCRIPTIONS_PER_CONNECTION) {
      this.sendError(ws, "SUBSCRIBE_LIMIT_EXCEEDED", `Maximum ${env.WS_MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions per connection`);
      return;
    }

    let snapshot;
    try {
      snapshot = await buildMatchSnapshot(this.pool, this.reads, matchId);
    } catch (err) {
      // A malformed matchId (not a valid uuid) throws at the DB layer —
      // treated the same as "not found" from the client's perspective, not
      // a server error; the gateway must not crash on a bad client input.
      logger.warn({ err: String(err), matchId }, "Failed to build match snapshot for subscribe");
      this.sendError(ws, "MATCH_NOT_FOUND", `No match with id ${matchId}`);
      return;
    }
    if (!snapshot) {
      this.sendError(ws, "MATCH_NOT_FOUND", `No match with id ${matchId}`);
      return;
    }

    const channel = cacheKeys.wsMatchChannel(matchId);
    let sockets = this.channelSubscribers.get(channel);
    if (!sockets) {
      sockets = new Set();
      this.channelSubscribers.set(channel, sockets);
      await this.subscriberRedis.subscribe(channel);
    }
    sockets.add(ws);
    subs.add(matchId);

    this.send(ws, { type: "match:snapshot", matchId, data: snapshot });
  }

  private async handleUnsubscribe(ws: WebSocket, matchId: string): Promise<void> {
    const subs = this.connectionSubscriptions.get(ws);
    if (!subs?.has(matchId)) return;
    subs.delete(matchId);
    await this.releaseChannelIfEmpty(matchId, ws);
  }

  private async handleClose(ws: WebSocket, ip: string): Promise<void> {
    websocketConnections.dec();
    const ipCount = this.ipConnectionCounts.get(ip) ?? 1;
    if (ipCount <= 1) this.ipConnectionCounts.delete(ip);
    else this.ipConnectionCounts.set(ip, ipCount - 1);

    this.aliveFlags.delete(ws);
    const subs = this.connectionSubscriptions.get(ws);
    this.connectionSubscriptions.delete(ws);
    if (!subs) return;

    for (const matchId of subs) {
      await this.releaseChannelIfEmpty(matchId, ws);
    }
  }

  private async releaseChannelIfEmpty(matchId: string, ws: WebSocket): Promise<void> {
    const channel = cacheKeys.wsMatchChannel(matchId);
    const sockets = this.channelSubscribers.get(channel);
    sockets?.delete(ws);
    if (sockets && sockets.size === 0) {
      this.channelSubscribers.delete(channel);
      await this.subscriberRedis.unsubscribe(channel);
    }
  }

  private send(ws: WebSocket, msg: { type: string } & Record<string, unknown>): void {
    this.rawSend(ws, JSON.stringify(msg), msg.type);
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { type: "error", code, message });
  }

  private rawSend(ws: WebSocket, data: string, type = "unknown"): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(data);
    websocketMessages.inc({ direction: "out", type });
  }
}
