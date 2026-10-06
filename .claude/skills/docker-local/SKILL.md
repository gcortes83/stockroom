---
name: docker-local
description: Containerization and local developer experience for Stockroom — multi-stage Dockerfiles for pnpm monorepo services, docker-compose with Postgres/RabbitMQ/healthchecks/migrations, env handling, Makefile/pnpm scripts, and troubleshooting. Use when creating or changing Dockerfiles, compose files, startup scripts or run instructions.
---

# Docker & Local Run

## Goal
A reviewer clones the repo and runs **one command**: `docker compose up --build` → open http://localhost:8080. No local Node, no `.env` editing required (compose has safe local defaults).

## docker-compose.yml shape
```yaml
services:
  postgres:   postgres:17-alpine, init script creates per-service DBs/users, volume, healthcheck pg_isready
  rabbitmq:   rabbitmq:4-management-alpine, healthcheck rabbitmq-diagnostics ping, UI on 15672
  catalog:    build services/catalog, depends_on postgres+rabbitmq (condition: service_healthy), healthcheck /health/ready
  orders:     same pattern
  payments:   same pattern
  gateway:    depends_on services healthy, port 3000 internal
  web:        nginx serving Vite build, proxies /api → gateway, port 8080:80
```
- Only `web` (8080) and optionally `rabbitmq` management (15672) and `postgres` (5432) are published to the host.
- Named volumes for data; `docker compose down -v` resets everything — document it.
- `compose.override.yml` (dev) can mount sources and run `pnpm dev` with hot reload; base file is production-like.

## Dockerfile (per service, pnpm monorepo)
```
FROM node:24-alpine AS base       corepack enable; pnpm via packageManager field
FROM base AS deps                 copy lockfile + workspace manifests → pnpm fetch
FROM deps AS build                copy sources → pnpm install --offline → turbo build --filter=<svc>...
                                  pnpm deploy --filter=<svc> --prod /out
FROM node:24-alpine AS runtime    non-root user, NODE_ENV=production, copy /out, HEALTHCHECK,
                                  CMD: node dist/main.js (migrations run inside the service at boot)
```
- `.dockerignore`: node_modules, dist, .git, coverage, .env, .idea, playwright-report.
- Pin base image tags; no `latest`. Use `tini` or `--init` for signal handling.
- Images should be small (<250 MB) and build cache-friendly (lockfile layers first).

## Startup ordering
- Use `depends_on: condition: service_healthy`, not sleep loops.
- Migrations run in each service entrypoint before the server starts; seeding of the example CSV happens once if catalog DB is empty (idempotent).

## Scripts
- Root `package.json`: `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `format`, `db:migrate`, `db:seed`.
- Optional `Makefile` with `make up`, `make down`, `make reset`, `make logs`, `make test` for reviewers who prefer it.

## Verification after any change
1. `docker compose build` succeeds from a clean checkout.
2. `docker compose up -d && docker compose ps` → all healthy.
3. Smoke: `curl -fsS localhost:8080/api/v1/products | head` and open the UI.
4. `docker compose down -v` cleans up.

## Troubleshooting notes for README
- Port already in use → change published port via env (`WEB_PORT`).
- Apple Silicon: all images used are multi-arch.
- Reset data: `docker compose down -v`.
