# Multi-stage build — Northflank/ADR-008's Portfolio Mode backend service.
# Same npm scripts this project already uses locally (build/migrate/start),
# not a parallel deployment-only build process to keep in sync separately.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# node-pg-migrate reads .sql migration files directly, not compiled output —
# these need to ship in the runtime image regardless of the TS build above.
COPY src/db/migrations ./src/db/migrations

EXPOSE 4000

# Migrations are idempotent (node-pg-migrate tracks applied ones in
# pgmigrations, docs/adr/ADR-005) — safe to run on every boot rather than
# needing a separate one-off deploy step, matching Portfolio Mode's
# one-process simplicity (ADR-008).
CMD ["sh", "-c", "npm run migrate:up && node dist/api/server.js"]
