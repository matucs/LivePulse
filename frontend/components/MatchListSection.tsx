"use client";

import { useQuery } from "@tanstack/react-query";
import type { MatchView } from "@/lib/apiClient";
import { MatchCard } from "./MatchCard";

interface Props {
  title: string;
  queryKey: string[];
  queryFn: () => Promise<{ matches: MatchView[] }>;
  refetchIntervalMs: number;
  emptyMessage: string;
}

export function MatchListSection({ title, queryKey, queryFn, refetchIntervalMs, emptyMessage }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn,
    refetchInterval: refetchIntervalMs,
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      ) : isError ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
          Couldn&apos;t reach LivePulse&apos;s backend right now — this section will retry automatically.
        </p>
      ) : data && data.matches.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}
