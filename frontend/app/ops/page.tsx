import type { Metadata } from "next";
import { OpsDashboard } from "@/components/OpsDashboard";

export const metadata: Metadata = {
  title: "LivePulse — Engineering Dashboard",
  description: "Real-time pipeline health: Kafka lag, event latency, WebSocket connections, provider quota.",
};

/**
 * §15 — the engineering dashboard. Deliberately a separate route from the
 * fan-facing product (§3): this page exists to demonstrate distributed-
 * systems judgment (consumer lag, event latency, provider quota), not to
 * be part of the sports-watching experience. See
 * docs/observability.md for what each figure actually measures and how it
 * was verified against real data.
 */
export default function OpsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Engineering Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">
          Live pipeline health — not part of the fan-facing product, and not what most visitors will see. This is
          the part that demonstrates distributed-systems judgment: Kafka consumer lag, event-processing latency,
          provider quota, WebSocket connections.
        </p>
      </div>
      <OpsDashboard />
    </div>
  );
}
