# Stockroom — Claude Code Project Guide

Enterprise-grade e-commerce code challenge. Source of truth for scope: `docs/requeriments.txt`.
The evaluators care less about feature completion and more about **asking the right questions, foreseeing problems, and justifying decisions**. Optimize for clarity of reasoning, not volume of code.

## Hard requirements (never violate)
- Runs locally: `docker compose up --build` must bring up the full system. No cloud services, no paid APIs, no secrets required.
- Local DB (PostgreSQL in compose).
- Features: Products CRUD, CSV product import, product search, purchase with a **fake** payment.
- UI for CRUD, search and purchase.
- **No code comments** in source files (challenge rule: "if you use AI, remove comments from the code"). Put reasoning in `docs/adr/` and `README.md`. Config files that require comments to be valid/obvious (e.g. `.env.example`) are the only exception.
- README must contain: decisions, approach, alternatives considered, how to run locally, and **the date the example CSV was downloaded**.

## Technical specification
- `docs/technical-specification.md` is the authoritative technical design: schemas, APIs, events, saga, CSV rules, config, security, tests. Code must match it; when a design changes, update the spec in the same change.

## Use cases
- `docs/use-cases.md` (UC-01…UC-15) defines actors, flows, exceptions and business rules. OpenSpec proposals must reference the UC ids they implement.

## Example data
- `Code Challenge E-Commerce.csv` (downloaded 2026-10-05) is intentionally dirty. Its profile, per-row handling and expected import counts are in `docs/csv-data-profile.md`. Treat that file as the source of truth for import rules.

## Stack (decided)
- Monorepo: pnpm workspaces + Turborepo, Node 24 LTS, TypeScript strict.
- `apps/web` React 19 + Vite + TanStack Query + React Router + react-hook-form + zod + Tailwind + shadcn/ui.
- `services/gateway` NestJS gateway/BFF · `services/catalog` · `services/orders` · `services/payments` (all NestJS).
- `packages/contracts` shared zod schemas + event envelopes; `packages/platform` technical cross-cutting code only (config, logging, problem+json, health, outbox, messaging; no domain logic); `packages/tsconfig`, `packages/eslint-config`.
- PostgreSQL 17 (database-per-service) via node-postgres (`pg`) with plain `.sql` migrations (ADR 0002), RabbitMQ (outbox + idempotent consumers).
- Tests: Vitest, Testcontainers, Supertest, Playwright.

## Workflow: spec-driven with OpenSpec
1. `/opsx:explore` — think through a problem, no code.
2. `/opsx:propose <change>` — creates `openspec/changes/<change>/{proposal,design,tasks}.md` + spec deltas.
3. Review with the user. **Do not implement until the user approves.**
4. `/opsx:apply <change>` — implement tasks in order, checking them off.
5. `/opsx:archive <change>` — merges spec deltas into `openspec/specs/`.
Use `openspec validate --strict` before asking for approval. Keep changes small and vertical (one capability per change).

## Skills (load before working in the area)
| Area | Skill |
|---|---|
| Architecture decisions, ADRs, C4 | `software-architecture` |
| Service boundaries, messaging, sagas | `microservices` |
| NestJS services | `backend-nestjs` |
| React UI | `frontend-react` |
| Schema, migrations, search, concurrency | `database-postgres` |
| REST contracts, errors, pagination | `api-design` |
| CSV import pipeline | `csv-import` |
| Dockerfiles, compose, local DX | `docker-local` |
| Test pyramid and tooling | `testing-strategy` |
| README, ADRs, submission checklist | `deliverables` |

## Engineering principles
- Ask before assuming on anything ambiguous in the requirements; record the assumption in the proposal.
- Correctness first for money and stock: integer cents, atomic conditional stock decrements, idempotency keys on purchase.
- Validate at every boundary (HTTP in, CSV rows, messages in) with zod schemas from `packages/contracts`.
- Services never share databases or import each other's code — only `packages/contracts` and `packages/platform`.
- Build order and full task list: `docs/implementation-plan.md` (each phase = one OpenSpec change).
- Small PR-sized commits, Conventional Commits.

## Definition of done (per task)
- `pnpm lint && pnpm typecheck && pnpm test` pass for affected workspaces.
- No comments, no `any`, no `console.log` (use the logger).
- Docker build still works; README/ADR updated if behavior or decisions changed.
- OpenSpec task checked off in `tasks.md`.

## Common commands (once scaffolded)
- `docker compose up --build` — full stack
- `pnpm dev` — local dev with hot reload (infra via `docker compose up postgres rabbitmq`)
- `pnpm test` / `pnpm test:e2e` / `pnpm lint` / `pnpm typecheck`
- Migrations: add `services/<svc>/migrations/NNN_name.sql`; they run automatically on service start (`runMigrations` in `@stockroom/platform`)
- `pnpm test:integration` (Docker required, uses Testcontainers)
- `node scripts/smoke.mjs` end-to-end smoke against `http://localhost:8080/api`
