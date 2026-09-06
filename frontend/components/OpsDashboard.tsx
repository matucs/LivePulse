"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/apiClient";

/**
 * §15's engineering dashboard — the piece this project's own README calls
 * "the point, not a bonus": consumer lag, event latency, quota, connection
 * counts, not the fan-facing UI. Polls /api/ops/summary every 5s — an
 * internal engineering tool, not subject to the same conservative-polling
 * discipline as the public match pages (docs/adr/ADR-002's budget is about
 * the external provider, not this project's own backend).
 */
export function OpsDashboard() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ["ops", "summary"],
    queryFn: () => api.opsSummary(),
    refetchInterval: 5_000,
  });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />;
  }
  if (isError || !data) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-sm text-text-muted">
        Couldn&apos;t load the ops summary. The backend may be temporarily unreachable.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Live Matches" value={data.liveMatches} />
        <Tile label="Kafka Events/sec" value={data.kafkaEventsPerSecond.toFixed(2)} />
        <Tile
          label="Kafka Consumer Lag"
          value={data.kafkaConsumerLagMax}
          tone={data.kafkaConsumerLagMax > 100 ? "warn" : "ok"}
        />
        <Tile label="WebSocket Connections" value={data.websocketConnections} />
        <Tile label="API Requests Today" value={data.apiRequestsToday} />
        <Tile
          label="API Requests Remaining"
          value={data.apiRequestsRemaining ?? "—"}
          tone={data.apiRequestsRemaining !== null && data.apiRequestsRemaining <= 5 ? "warn" : "ok"}
        />
        <Tile
          label="Redis Hit Rate"
          value={data.redisHitRate !== null ? `${(data.redisHitRate * 100).toFixed(1)}%` : "—"}
        />
        <Tile
          label="Event Processing Latency"
          value={
            data.eventProcessingLatencyAvgSeconds !== null
              ? formatLatency(data.eventProcessingLatencyAvgSeconds)
              : "—"
          }
        />
        <Tile
          label="Failed Events"
          value={data.failedEvents}
          tone={data.failedEvents > 0 ? "warn" : "ok"}
        />
      </div>

      <p className="text-xs text-text-muted">
        Last updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—"} · refreshes every 5s ·
        computed from the same instruments as{" "}
        <code className="rounded bg-surface px-1 py-0.5">GET /metrics</code> (Prometheus format) — see{" "}
        <code className="rounded bg-surface px-1 py-0.5">docs/observability.md</code>.
      </p>
    </div>
  );
}

function formatLatency(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "ok" | "warn";
}) {
  const valueColor = tone === "warn" ? "text-warn" : tone === "ok" ? "text-accent" : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}
