# 0001. Microservices architecture in a pnpm monorepo

- Status: accepted
- Date: 2026-10-05

## Context

The challenge asks for an "enterprise-grade" e-commerce application (products CRUD, CSV import, search, fake-payment purchase) that runs locally via Docker. Evaluators focus on judgment and foresight rather than feature count.

## Decision

Split the system into small NestJS services by bounded context (catalog incl. inventory, orders, payments) behind a NestJS gateway, with a React SPA. Services own their databases (database-per-service on one local PostgreSQL instance) and integrate asynchronously through RabbitMQ using a transactional outbox and idempotent consumers. All code lives in one pnpm + Turborepo monorepo with a shared `packages/contracts` for schemas and events.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Modular monolith | Simplest to run and reason about, ACID checkout, fewer containers | Boundaries enforced only by convention; demonstrates less about distributed consistency |
| Monolith + extracted payments service | Shows one async boundary with less overhead | Half-way design, harder to justify which parts are split |
| Microservices (chosen) | Explicit boundaries, independent deployability, showcases saga/outbox/idempotency | More moving parts, eventual consistency in checkout, more operational overhead locally |

## Consequences

- Checkout becomes a saga orchestrated by the orders service with compensations.
- Need for correlation ids, health checks, and reliable messaging patterns from day one.
- Local startup relies on docker-compose healthchecks for ordering.
- Inventory stays inside catalog to avoid a distributed stock-ownership problem.
