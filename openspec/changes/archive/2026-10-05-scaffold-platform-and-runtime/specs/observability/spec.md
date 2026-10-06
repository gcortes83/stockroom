## Purpose

Makes the running system inspectable: whether each service is alive and ready, and what happened to a given request across services.

## ADDED Requirements

### Requirement: Liveness and readiness

Every service SHALL expose `GET /health/live` and `GET /health/ready`. Readiness MUST report the database, broker and outbox backlog checks, and respond `503` when any check fails.

#### Scenario: Broker unavailable
- **WHEN** a service cannot reach RabbitMQ
- **THEN** `GET /health/ready` responds `503` with `checks.broker` set to false

#### Scenario: Gateway readiness reflects upstreams
- **WHEN** one upstream service is not ready
- **THEN** the gateway's readiness responds `503` and lists each upstream's status

### Requirement: Structured correlated logs

Services MUST log JSON lines that include the service name and the request's correlation id, MUST NOT log card numbers or CVCs, and SHALL skip access logs for health probes.

#### Scenario: One request is traceable in logs
- **WHEN** an order is placed with `x-request-id: abc`
- **THEN** the gateway, orders, catalog and payments logs for that order carry correlation id `abc`

#### Scenario: Sensitive fields are redacted
- **WHEN** a request body contains `cardNumber` or `cvc`
- **THEN** those values appear as `[redacted]` in logs
