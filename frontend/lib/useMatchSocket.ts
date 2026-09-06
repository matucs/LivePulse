"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MatchEvent, MatchView, TeamMatchStatistics } from "./apiClient";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws";

interface MatchSnapshotPayload {
  match: MatchView;
  events: MatchEvent[];
  statistics: TeamMatchStatistics[];
}

/**
 * docs/adr/ADR-006 + docs/websocket.md, client side. Writes straight into
 * the same TanStack Query cache keys MatchDetailClient's `useQuery` calls
 * already read from — the doc comment above that component's original
 * `refetchInterval` said Phase 5 would swap the transport "without
 * changing anything below this file," and this is what makes that true:
 * the component doesn't know or care whether its data arrived from a
 * fetch or a push.
 *
 * Reconnect: exponential backoff (1s → 30s cap, ±20% jitter), matching
 * websocket.md's client reconnect spec — `onopen` always re-sends
 * `subscribe`, so a reconnect is indistinguishable from a fresh connect
 * from the server's point of view (a fresh snapshot every time, never an
 * assumption that missed messages get replayed).
 */
export function useMatchSocket(matchId: string): { isConnected: boolean } {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closedByCleanup = false;

    function connect(): void {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        attempt = 0;
        setIsConnected(true);
        ws?.send(JSON.stringify({ type: "subscribe", matchId }));
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          handleMessage(JSON.parse(event.data));
        } catch {
          // A malformed frame shouldn't take down the socket — REST polling
          // (still running as a fallback whenever isConnected is false, and
          // available on demand regardless) covers the gap either way.
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (closedByCleanup) return;
        attempt += 1;
        const base = Math.min(1000 * 2 ** (attempt - 1), 30_000);
        const jitter = base * 0.2 * (Math.random() * 2 - 1);
        reconnectTimer = setTimeout(connect, base + jitter);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    function handleMessage(msg: Record<string, unknown>): void {
      if (msg.type === "match:snapshot") {
        const data = msg.data as MatchSnapshotPayload;
        queryClient.setQueryData(["match", matchId], data.match);
        queryClient.setQueryData(["match", matchId, "events"], { events: data.events });
        queryClient.setQueryData(["match", matchId, "statistics"], { statistics: data.statistics });
        return;
      }

      if (msg.type === "match:update") {
        const payload = msg.data as Record<string, unknown>;
        queryClient.setQueryData<MatchView | undefined>(["match", matchId], (old) => {
          if (!old) return old;
          if (msg.eventType === "MATCH_SCORE_CHANGED") {
            return { ...old, homeScore: payload.homeScore as number, awayScore: payload.awayScore as number };
          }
          if (msg.eventType === "MATCH_STATUS_CHANGED") {
            return { ...old, status: payload.newStatus as MatchView["status"] };
          }
          return old;
        });
        return;
      }

      if (msg.type === "match:event") {
        // The pushed event carries only raw ids (matchId/type/minute/teamId/
        // playerId/sequenceNumber) — team/player NAMES are a REST-only
        // enrichment step (api/eventView.ts), not part of the Kafka payload
        // (see docs/websocket.md's implementation note). Merging a
        // name-less row into the cache would render "undefined" in the
        // timeline, so this refetches the enriched list instead — one
        // extra REST round-trip per event, an honest tradeoff given what
        // the push actually contains.
        void queryClient.invalidateQueries({ queryKey: ["match", matchId, "events"] });
        return;
      }

      if (msg.type === "match:stats") {
        const payload = msg.data as { teamId: string; statistics: TeamMatchStatistics };
        queryClient.setQueryData<{ statistics: TeamMatchStatistics[] } | undefined>(
          ["match", matchId, "statistics"],
          (old) => {
            const rest = (old?.statistics ?? []).filter((s) => s.teamId !== payload.teamId);
            return { statistics: [...rest, payload.statistics] };
          },
        );
      }
    }

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "unsubscribe", matchId }));
      }
      ws?.close();
    };
  }, [matchId, queryClient]);

  return { isConnected };
}
