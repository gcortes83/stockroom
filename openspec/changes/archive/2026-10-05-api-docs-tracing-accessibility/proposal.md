## Why

The first release listed four items as "not implemented yet": API documentation, HTTP-level test suites, browser tests and distributed tracing. The browser tests then revealed colour-contrast failures. Closing these makes the API self-describing, makes cross-service behaviour observable, and turns accessibility into an enforced requirement.

## What Changes

- OpenAPI 3.1 document generated from the shared zod contracts, served with Swagger UI at `/api/docs`.
- Optional OpenTelemetry tracing: one trace per purchase across gateway, orders, catalog and payments, carried through the outbox and RabbitMQ; Jaeger as an opt-in compose profile.
- Accessibility: WCAG 2.1 AA colour contrast in both themes and respect for reduced-motion preferences.
- Test suites: Supertest HTTP suites for every service and a Playwright suite with axe checks (these add no behaviour, so they appear in tasks only).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-conventions`: adds the API documentation requirement.
- `observability`: adds the distributed tracing requirement.
- `web-storefront`: adds the accessibility requirement.

## Impact

- gateway (Swagger UI), contracts (`buildOpenApiDocument`), platform (tracing bootstrap and trace context helpers).
- Migration `002_outbox_trace_context.sql` in catalog, orders and payments.
- Compose: `jaeger` service in the `observability` profile; `OTEL_*` variables.
- Web: colour tokens and `MotionConfig`.

## Non-goals

- Metrics and log shipping; tracing is off by default.

## Open questions / assumptions

- Tracing overhead is acceptable for local use; it stays opt-in.
