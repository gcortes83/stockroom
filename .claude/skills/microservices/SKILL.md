---
name: microservices
description: Microservices patterns for Stockroom — service boundaries, sync vs async communication, RabbitMQ, transactional outbox, idempotent consumers, checkout saga, contracts, gateway, resilience and observability. Use when touching cross-service flows, events, the gateway, or service-to-service calls.
---

# Microservices

## Topology
```
web ──HTTP──▶ gateway ──HTTP──▶ catalog ─┐
                      ├─HTTP──▶ orders  ─┼─▶ RabbitMQ (topic exchange "stockroom.events")
                      └─HTTP──▶ payments ┘
postgres: catalog_db | orders_db | payments_db  (one container locally, separate databases + users)
```
- Each service: own database, own SQL migrations, own Dockerfile, own healthcheck.
- Shared code ONLY via `packages/contracts` (zod schemas, types, event envelopes) and `packages/platform` (technical cross-cutting: config, logging, problem+json, health, outbox, RabbitMQ, idempotent consumer base; never domain logic). Never import another service.
- The gateway does routing, request-id, CORS, rate limiting, payload limits and OpenAPI aggregation. No business logic.

## Communication rules
- **Queries from the UI**: synchronous HTTP through the gateway.
- **State changes spanning services**: asynchronous events via RabbitMQ.
- Avoid synchronous chains deeper than gateway → one service. If orders needs product data at checkout, it calls catalog once (price/stock snapshot) with timeout + retry, and stores a snapshot on the order line.

## Checkout saga (orchestrated by orders)
```
POST /orders (Idempotency-Key)
 1. orders: create Order(PENDING) + outbox(OrderCreated)
 2. catalog: on OrderCreated → reserve stock atomically → StockReserved | StockReservationFailed
 3. orders: on StockReserved → status AWAITING_PAYMENT → command payments
 4. payments: fake charge → PaymentSucceeded | PaymentFailed
 5. orders: PaymentSucceeded → CONFIRMED → catalog commits reservation
            PaymentFailed / StockReservationFailed → CANCELLED → catalog releases reservation
 6. Reservations have TTL; a sweeper releases expired ones (compensation for lost messages).
```
- Order state machine is explicit and transitions are guarded (reject illegal transitions).
- UI polls `GET /orders/:id` (or SSE) until terminal state.
- Document in an ADR why orchestration was chosen over choreography (single place to reason about the flow).

## Reliability patterns (mandatory)
- **Transactional outbox**: write the event to an `outbox` table in the same DB transaction as the state change; a relay publishes and marks it sent. Never publish directly inside a request transaction.
- **Idempotent consumers**: `processed_messages(message_id PK)` table; insert in the same transaction as the handler side effect; skip duplicates.
- **At-least-once delivery** assumed everywhere. Handlers must be idempotent.
- **Retries** with exponential backoff + dead-letter queue per consumer (`<queue>.dlq`).
- **Timeouts** on every HTTP call (default 2s) and a circuit breaker for catalog calls from orders.
- **Idempotency-Key** header on `POST /orders` and `POST /payments`, stored with the response for replay.

## Event envelope (packages/contracts)
```ts
{ id: uuid, type: "catalog.stock.reserved.v1", occurredAt: ISO8601, correlationId: uuid,
  causationId: uuid | null, producer: "catalog", payload: {...} }
```
- Event names: `<context>.<entity>.<past-tense-verb>.v<N>`. Breaking change → new version, keep old one until consumers migrate.
- Validate every consumed message with the zod schema; invalid → DLQ, never crash the consumer.

## Observability
- Correlation id: generated at the gateway (`x-request-id`), propagated via HTTP headers and event `correlationId`.
- Structured JSON logs (pino) with `service`, `correlationId`, `orderId`/`sku` where relevant.
- `/health/live` and `/health/ready` (ready checks DB + broker) on every service; compose healthchecks use them.
- Optional (stretch): OpenTelemetry traces to a local Jaeger container.

## Configuration
- 12-factor: env vars only, validated with zod at boot (fail fast). `.env.example` committed, `.env` ignored.
- Service URLs come from env (`CATALOG_URL=http://catalog:3001`).

## Anti-patterns to reject
- Shared database or shared DB connection pool between services.
- Distributed transactions / 2PC.
- Publishing events before the DB commit.
- Business logic in the gateway.
- Chatty synchronous calls in loops (N+1 across the network).

## Trade-off to document honestly
Microservices add operational cost (broker, eventual consistency, more containers) that a challenge of this size would not strictly need. State that a modular monolith was considered, and that microservices were chosen to demonstrate boundaries, consistency handling and failure modes. Keep each service small.
