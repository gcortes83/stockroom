## Why

The purchase flow spans catalog, orders and payments. Without reliable messaging, a crash between a database commit and a publish loses events, and broker redeliveries cause double effects such as two charges or two stock decrements. This must be solved once, before the checkout is built.

## What Changes

- Transactional outbox in every service: events are stored in the same transaction as the state change and published by a relay.
- Idempotent consumers: each message's side effects are applied at most once per consumer.
- Topic exchange with per-consumer queues, retry tiers (1 s, 5 s, 30 s) and a dead-letter queue per consumer.
- Versioned event contracts validated on consume.
- RabbitMQ with pinned version, configuration and pre-declared exchanges; services survive broker restarts.

## Capabilities

### New Capabilities

- `reliable-messaging`: delivery guarantees, retries, dead-lettering, contract validation and broker-restart behaviour.

### Modified Capabilities

None.

## Impact

- Services: catalog, orders, payments; `@stockroom/platform` (broker, outbox relay, consumer helper).
- Database: `outbox` and `processed_messages` tables in each service database.
- Infrastructure: `infra/rabbitmq/rabbitmq.conf`, `infra/rabbitmq/definitions.json`.

## Non-goals

- Event replay and event sourcing (ADR 0003).
- Global ordering guarantees; handlers rely on state-machine guards instead.

## Open questions / assumptions

- At-least-once delivery is acceptable as long as effects are idempotent.
