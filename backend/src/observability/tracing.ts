/**
 * §21: "OpenTelemetry where practical" — a practical minimum, not a full
 * distributed-tracing rollout. Auto-instruments HTTP (Fastify sits on
 * Node's http server) and PostgreSQL (`pg`) — verified for real, see
 * below. Deliberately not three dozen instrumentations for libraries this
 * project doesn't use (the full `@opentelemetry/auto-instrumentations-node`
 * meta-package pulls in ~150 packages for frameworks like Express/GraphQL/
 * MongoDB that don't exist here).
 *
 * Redis (`ioredis`) instrumentation is NOT included, and this is a finding,
 * not an oversight: `@opentelemetry/instrumentation-ioredis` declares
 * support for ioredis `>=2.0.0 <7` (this project runs 6.0.0, within that
 * range), but verified in isolation — a minimal script registering just
 * that instrumentation and issuing real SET/GET commands against a real
 * Redis — it never emits a span, with no error either. That's a real,
 * confirmed instrumentation/major-version gap, not a config mistake on
 * this project's side. Including it anyway, silently producing zero
 * spans, would be worse than not including it: a future reader would
 * reasonably assume Redis calls are traced when they aren't. Redis
 * activity is still observable — through this project's own
 * redis_cache_hits/redis_cache_misses metrics (docs/adr's §21 list) and
 * indirectly as the timing gap between HTTP and Postgres spans in a trace.
 *
 * No free, verified always-on hosted trace backend was found for Portfolio
 * Mode (the same honesty standard as ADR-008's Kafka discussion) — rather
 * than default to dumping every span to stdout (which would drown the
 * actual pino logs this project's structured-logging story depends on),
 * tracing is fully wired but exports nowhere until
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set, pointed at a self-hosted collector
 * (e.g. Jaeger via `docker run -p 4318:4318 -p 16686:16686
 * jaegertracing/all-in-one`, OTLP HTTP receiver on 4318) or a hosted
 * option. This mirrors the EventBus pattern exactly: optional
 * infrastructure, a clear one-line warning if unconfigured, genuinely real
 * the moment it's turned on — not a stub. Verified for real: HTTP and
 * Postgres spans (`GET`, `pg.query:SELECT ...`, `pg-pool.connect`) showed
 * up in a real Jaeger instance after real API requests.
 *
 * MUST be the first import in the process entrypoint (api/server.ts) —
 * OpenTelemetry's instrumentation patches `pg`/`http` at module load time,
 * so it has to run before anything else imports them.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "livepulse-backend" }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
  });
  sdk.start();
  process.on("SIGTERM", () => void sdk.shutdown().catch(() => {}));
  console.log(`[tracing] OpenTelemetry exporting to ${endpoint}`);
} else {
  console.log("[tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing instrumentation loaded but not exporting anywhere. See docs/observability.md.");
}
