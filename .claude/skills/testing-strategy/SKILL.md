---
name: testing-strategy
description: Test strategy for Stockroom — test pyramid, Vitest unit tests, Testcontainers integration tests for Postgres/RabbitMQ, Supertest HTTP tests, contract tests for events, concurrency tests for stock, Playwright e2e, fixtures and CI-like local commands. Use when writing tests, planning the test tasks of an OpenSpec change, or verifying a feature.
---

# Testing Strategy

## Pyramid
| Level | Tool | What | Where |
|---|---|---|---|
| Unit | Vitest | domain logic, value objects (Money, Sku), CSV row normalization, order state machine, use cases with fakes | `src/**/*.spec.ts` |
| Integration | Vitest + Testcontainers | pg repositories, migrations, search queries, outbox relay, consumers with real RabbitMQ | `test/integration/**` |
| HTTP | Supertest | controller → DB round trips, status codes, problem+json | `test/http/**` |
| Contract | Vitest | every event/DTO example validates against `packages/contracts` schemas on both producer and consumer side | `packages/contracts/test` |
| E2E | Playwright | CRUD, search, CSV import, purchase happy + out-of-stock + payment-declined against docker compose | `e2e/` |

## Must-have tests (non-negotiable for the challenge)
- Concurrent purchase of the last unit → exactly one order CONFIRMED, stock never negative.
- Idempotent `POST /orders` with the same key → one order.
- Duplicate message delivery → handler side effect applied once.
- CSV: the example file imports with the expected counts; each dirty-row category produces the right error.
- Price parsing has no float drift.
- Search: relevance (name match ranks above description match), filters, pagination boundaries.
- Optimistic lock conflict on product update → 409.

## Conventions
- Arrange/Act/Assert, one behavior per test, descriptive names (`rejects order when stock is insufficient`).
- Test builders/factories (`aProduct().withStock(1).build()`) instead of large inline literals.
- No mocking of what you own at integration level; mock only external boundaries.
- Deterministic: inject clock and id generator; no sleeps — poll with timeouts for async assertions.
- Coverage target ~80% lines on domain/application; do not chase coverage on glue code.
- No comments in tests either; names carry intent.

## Commands
- `pnpm test` all unit + integration (Docker required for Testcontainers).
- `pnpm --filter @stockroom/catalog test -- --watch` focused.
- `pnpm test:e2e` spins up compose, runs Playwright, tears down.

## Per OpenSpec change
- tasks.md must list the tests per scenario in the spec delta; each `Scenario:` maps to at least one automated test.
