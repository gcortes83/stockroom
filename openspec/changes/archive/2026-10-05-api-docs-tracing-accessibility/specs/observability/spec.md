## ADDED Requirements

### Requirement: Distributed tracing

When tracing is enabled, the system SHALL export OpenTelemetry traces in which one purchase forms a single trace across gateway, orders, catalog and payments. That trace MUST include HTTP calls, database queries, and a publish and a process span for each event, including events delivered through the outbox. Tracing MUST be disabled by default.

#### Scenario: One order, one trace
- **WHEN** tracing is enabled and a shopper places an order
- **THEN** Jaeger shows one trace containing spans from all four services and the `orders.order.created.v1` publish and process spans

#### Scenario: Tracing disabled
- **WHEN** the stack starts without `OTEL_ENABLED=true`
- **THEN** no traces are exported and the services behave identically
