# 0003. RabbitMQ with transactional outbox and idempotent consumers

- Status: accepted
- Date: 2026-10-05

## Context

State changes cross service boundaries during checkout. Publishing directly after a commit loses events on crashes; brokers deliver at least once.

## Decision

Events are written to an `outbox` table in the same transaction as the state change and published by a relay (`FOR UPDATE SKIP LOCKED`, publisher confirms). Consumers record `processed_messages` in the same transaction as their side effects. Failed handlers are retried through TTL queues (1 s, 5 s, 30 s) and dead-lettered after three attempts.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Kafka / Redpanda | Replayable log, high throughput | Heavier locally; per-message retry and DLQ need extra tooling |
| Redis Streams | Simple | Weaker routing and DLQ ergonomics |
| Publish after commit | Simpler | Loses events on crash between commit and publish |

## Consequences

At-least-once delivery with exactly-once effects. Each service needs `outbox` and `processed_messages` tables. No replay; the outbox is the durable record.
