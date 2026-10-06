## Context

See proposal.md. The decision record is ADR 0003.

## Goals / Non-Goals

**Goals:** no lost events, no duplicate effects, poison messages isolated, automatic recovery.
**Non-Goals:** exactly-once delivery at the transport level.

## Decisions

- **Outbox**: `writeOutbox(tx, event)` inside the use-case transaction. The relay polls every 250 ms (and is woken right after commits), locks rows with `FOR UPDATE SKIP LOCKED`, publishes with publisher confirms, then marks rows published. Failures increment `attempts` and record `last_error`.
- **Envelope**: `{ id, type, occurredAt, correlationId, causationId, producer, payload }`, with type `<context>.<entity>.<event>.v<N>`. Payloads are validated with zod. Invalid messages go straight to the DLQ; unknown types are acknowledged and ignored.
- **Idempotent consumer**: insert `(message_id, consumer)` into `processed_messages` in the same transaction as the handler. If it already exists, skip.
- **Topology**: exchange `stockroom.events` (topic), `stockroom.retry` and `stockroom.dlx` (direct). Each consumer has its queue, `.retry.{1s,5s,30s}` TTL queues that dead-letter back to it, and a `.dlq`.
- **Closed channels**: settling a delivery never throws. If the channel closed mid-handler, the message is left unacknowledged for redelivery instead of crashing the service.
- **Broker in Docker**: image pinned to 4.3, configuration file, definitions that create the user and the exchanges, and remote `guest` access disabled.

### Events

| Event | Producer | Consumer |
|---|---|---|
| `orders.order.created/confirmed/cancelled.v1` | orders | catalog |
| `catalog.stock.reserved/reservation-failed/reservation-expired/commit-failed.v1` | catalog | orders |
| `payments.charge.requested.v1`, `payments.refund.requested.v1` | orders | payments |
| `payments.payment.succeeded/failed/refunded.v1` | payments | orders |

### Alternatives considered

| Option | Trade-off |
|---|---|
| Kafka / Redpanda | Replayable log, but heavier and with no per-message retry or DLQ |
| Publish after commit | Simpler, but loses events on crash |
| amqplib nack-requeue for retries | No delay between attempts; causes hot loops |

## Risks / Trade-offs

- [Outbox grows] → published rows can be purged; readiness fails when more than 1000 rows are older than 60 s.
