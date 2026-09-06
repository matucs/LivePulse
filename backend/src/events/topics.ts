/**
 * Topic/consumer-group names — docs/kafka.md is the operational reference,
 * docs/adr/ADR-003 is the decision record. Defined once here so a typo in a
 * topic name is a compile error, not a silently-never-consumed message.
 */
export const Topics = {
  MatchUpdated: "sports.match.updated",
  MatchScoreChanged: "sports.match.score-changed",
  MatchStatusChanged: "sports.match.status-changed",
  MatchEventCreated: "sports.match.event-created",
  StatisticsUpdated: "sports.statistics.updated",
  NotificationRequested: "sports.notification.requested",
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];

export const ALL_TOPICS: Topic[] = Object.values(Topics);

/** `<topic>.dlq` — a message that exhausts retries lands here (ADR-003), never silently discarded. */
export function dlqTopic(topic: Topic): string {
  return `${topic}.dlq`;
}

export const ConsumerGroups = {
  Scores: "scores-consumer-group",
  Stats: "stats-consumer-group",
  Alerts: "alerts-consumer-group",
  NotificationStub: "notification-stub-consumer-group",
} as const;
