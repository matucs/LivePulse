# LivePulse — Frontend

Next.js (App Router) + TanStack Query. Polls the backend REST API (Phase 3
mechanism — swapped for WebSocket push in Phase 5, per
[docs/adr/ADR-006](../docs/adr/ADR-006-websocket-architecture.md), without
changing anything below the query layer).

See the [project README](../README.md) for the full picture, and
[docs/architecture.md](../docs/architecture.md) for how this fits into the
rest of the system.

## Run it

```bash
cp .env.local.example .env.local   # points at the backend, defaults to localhost:4000
npm install
npm run dev
```

Requires the backend (`../backend`) running and reachable at
`NEXT_PUBLIC_API_URL`.
