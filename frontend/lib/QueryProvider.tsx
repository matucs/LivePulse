"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "./apiClient";

/**
 * The mechanism behind "the page updates without a refresh" (§3) in Phase
 * 3 — plain polling via refetchInterval on each query. Phase 5 replaces the
 * transport with WebSocket push (docs/adr/ADR-006); this provider and the
 * query keys underneath it don't change when that happens, only how a
 * query's data gets invalidated.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            refetchOnWindowFocus: true,
            // A 4xx (404 — this match/league doesn't exist, or a malformed
            // id) will never succeed no matter how many times it's
            // retried — TanStack Query's default (3 retries, exponential
            // backoff) applied to those left a user staring at a loading
            // skeleton for 7+ seconds before an error ever appeared.
            // 5xx/network failures are still worth one real retry.
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
