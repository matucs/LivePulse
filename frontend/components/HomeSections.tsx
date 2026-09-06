"use client";

import { api } from "@/lib/apiClient";
import { MatchListSection } from "./MatchListSection";

export function HomeSections() {
  return (
    <>
      <MatchListSection
        title="Live now"
        queryKey={["matches", "live"]}
        queryFn={api.liveMatches}
        refetchIntervalMs={15_000}
        emptyMessage="No matches live right now — check back during a matchday, or see what's coming up below."
      />
      <MatchListSection
        title="Upcoming"
        queryKey={["matches", "upcoming"]}
        queryFn={api.upcomingMatches}
        refetchIntervalMs={60_000}
        emptyMessage="No upcoming fixtures tracked yet for the next 7 days."
      />
      <MatchListSection
        title="Recently completed"
        queryKey={["matches", "recent"]}
        queryFn={() => api.recentMatches(10)}
        refetchIntervalMs={60_000}
        emptyMessage="No completed matches yet."
      />
    </>
  );
}
