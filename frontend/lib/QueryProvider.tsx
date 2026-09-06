"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

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
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
