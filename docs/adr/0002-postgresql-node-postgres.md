# 0002. PostgreSQL with node-postgres and SQL migrations, one database per service

- Status: accepted
- Date: 2026-10-05

## Context

Each service needs its own transactional store. The critical queries (weighted full-text search, conditional stock updates, outbox with `SKIP LOCKED`, batch upserts with `unnest`) are hand-written SQL. Prisma was the original choice.

## Decision

PostgreSQL 17, one database and role per service in one local container. Data access through `pg` with parameterized queries in repository adapters. Plain `.sql` migrations applied at boot by `runMigrations` in `@stockroom/platform` (advisory lock, one transaction per file, recorded in `schema_migrations`).

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Prisma | Typed CRUD, popular | Generated clients collide in the pnpm store, native engines complicate Alpine/arm64, most queries would be raw SQL anyway |
| Kysely | Type-safe builder | More code and API surface for little gain at this size |
| MongoDB | Flexible schema for messy CSVs | Weaker multi-document transactions and conditional updates; no relational integrity for order lines |
| Schema per service | One database | Weaker isolation than separate databases and roles |

## Consequences

No codegen, small images, DDL in the spec equals the migration. Row types are hand-written, so integration tests against real Postgres guard against drift.
