## Purpose

Guarantees that state changes crossing service boundaries are neither lost nor applied twice, and that failures are retried or isolated instead of blocking the system.

## ADDED Requirements

### Requirement: No lost events

A state change and the events it produces MUST be committed atomically, and every committed event MUST eventually be published, including after a crash or a broker outage.

#### Scenario: Crash between commit and publish
- **WHEN** a service commits an order and stops before publishing
- **THEN** the event is published after the service restarts

#### Scenario: Broker temporarily down
- **WHEN** RabbitMQ is unavailable while orders are placed
- **THEN** orders are accepted and their events are published once the broker is back

### Requirement: At-most-once effects per consumer

Each consumer SHALL apply the side effects of a given message at most once, even if the message is delivered several times.

#### Scenario: Duplicate delivery
- **WHEN** the same `OrderCreated` message is delivered twice to the catalog
- **THEN** stock is reserved only once

### Requirement: Retries and dead-lettering

A message whose handler fails SHALL be retried after 1 s, 5 s and 30 s, then moved to the consumer's dead-letter queue. Messages that are not valid JSON or do not match their contract MUST go directly to the dead-letter queue. Messages of unknown types MUST be acknowledged and ignored.

#### Scenario: Transient failure
- **WHEN** a handler fails once and then succeeds
- **THEN** the message is processed on the retry and never reaches the dead-letter queue

#### Scenario: Poison message
- **WHEN** a message payload violates its contract
- **THEN** it is placed in the dead-letter queue without retries

### Requirement: Versioned event contracts

Events SHALL carry `id`, `type`, `occurredAt`, `correlationId`, `causationId`, `producer` and `payload`, with type names ending in a version (`.v1`). Breaking changes MUST use a new version.

#### Scenario: Every event type has a valid example
- **WHEN** the contract tests run
- **THEN** an example payload of each event type validates against its schema

### Requirement: Broker restarts are survivable

Services SHALL reconnect to RabbitMQ automatically and MUST NOT crash when a channel closes during message processing. Messages caught mid-flight are redelivered.

#### Scenario: Restart with orders in flight
- **WHEN** RabbitMQ restarts while orders are being processed
- **THEN** every order still reaches a terminal state, no service process exits, and dead-letter queues stay empty
