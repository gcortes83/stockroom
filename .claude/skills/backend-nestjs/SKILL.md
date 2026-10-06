---
name: backend-nestjs
description: Backend engineering standards for Stockroom NestJS services (catalog, orders, payments, gateway) — module layout, hexagonal layering, validation with zod, error handling, config, logging, security and testing. Use whenever writing or reviewing backend TypeScript code.
---

# Backend — NestJS

## Service layout
```
services/<name>/
  src/
    main.ts                      bootstrap: pino logger, validation, shutdown hooks, OpenAPI
    app.module.ts
    config/                      zod-validated env schema
    modules/<feature>/
      domain/                    entities, value objects, errors (pure TS)
      application/               use cases, ports
      infrastructure/            pg repositories, messaging adapters
      interface/http/            controllers, request/response mapping
      interface/messaging/       consumers
    shared/                      outbox relay, idempotency, health, problem-details filter
  migrations/NNN_name.sql
  test/                          integration + http tests
  Dockerfile
```

## Rules
- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any`, no non-null assertions without reason.
- **No comments in code.** Name things well instead.
- Controllers are thin: parse → call use case → map result. No SQL in controllers.
- Use cases receive plain inputs and return results; they depend on ports (interfaces), injected via Nest tokens.
- Domain errors are typed classes (`ProductNotFound`, `DuplicateSku`, `InsufficientStock`) mapped to HTTP in one exception filter.
- Validation: zod schemas from `packages/contracts` via a `ZodValidationPipe` (nestjs-zod). Single source of truth for API types shared with the frontend.
- Money: `priceCents: number` (integer) in domain; convert at boundaries. Never `parseFloat` on money. Use a `Money` value object.
- Dates: UTC ISO-8601 strings on the wire, `timestamptz` in DB.
- IDs: UUID v7 (time-ordered) generated in app.

## Errors — RFC 9457 problem+json
```json
{ "type": "https://stockroom.local/problems/insufficient-stock", "title": "Insufficient stock",
  "status": 409, "detail": "SKU ABC-1 has 2 units, 5 requested", "instance": "/orders",
  "correlationId": "...", "errors": [{ "path": "lines.0.quantity", "message": "..." }] }
```
400 validation · 404 not found · 409 conflict (duplicate SKU, stock, illegal state) · 422 semantic CSV errors · 429 rate limit · 500 never leaks stack traces.

## Config & bootstrap
- `ConfigModule` with zod-validated env; app refuses to start on invalid config.
- `enableShutdownHooks()`; close the pg pool and AMQP connections gracefully.
- `nestjs-pino` with redaction of secrets; request logging includes `x-request-id`.
- `/health/live` and `/health/ready` come from `InfraModule` in `@stockroom/platform` (DB, broker, outbox backlog).
- Swagger/OpenAPI at `/docs` per service (generated from zod via nestjs-zod).

## Security baseline
- helmet, CORS restricted to the web origin, body size limits, upload size limit for CSV (e.g. 5 MB), MIME + extension check.
- Rate limiting with `@fastify/rate-limit` at the gateway (proxied routes bypass Nest guards).
- Parameterized `pg` queries only. Dynamic SQL fragments (ORDER BY, conditions) come from whitelists, never from input.
- No secrets in the repo; defaults only in `.env.example` for local use.
- Admin endpoints (CRUD/import) behind a simple role guard if auth is in scope; otherwise document the assumption.

## Persistence patterns
- Repository per aggregate; transactions via `Database.transaction(tx => ...)` from `@stockroom/platform`.
- Stock decrement must be atomic: `UPDATE ... SET stock = stock - $n WHERE id = $id AND stock >= $n` and check affected rows. See `database-postgres`.
- Optimistic concurrency on product updates with a `version` column (`If-Match` / 409 on mismatch).
- Outbox written in the same transaction as state changes (see `microservices`).

## Testing (see testing-strategy)
- Unit-test domain and use cases with in-memory fakes of ports.
- Integration-test repositories and consumers against real Postgres/RabbitMQ via Testcontainers.
- HTTP tests with Supertest on the Nest app with real DB.

## Review checklist
- [ ] Input validated at the boundary with a contracts schema
- [ ] Errors mapped to problem+json with correct status
- [ ] Transaction boundaries correct; outbox used for events
- [ ] Idempotent where retried
- [ ] Logged with correlation id, no sensitive data
- [ ] Tests at the right level, no comments, no `any`
