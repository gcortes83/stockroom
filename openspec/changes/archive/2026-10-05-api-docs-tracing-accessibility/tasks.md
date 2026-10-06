## 1. API documentation

- [x] 1.1 OpenAPI builder in contracts from the zod schemas
- [x] 1.2 Swagger UI in the gateway at `/api/docs`
- [x] 1.3 Contract test for route coverage and a Playwright check through nginx

## 2. HTTP test suites

- [x] 2.1 Split the platform bootstrap so tests can override providers
- [x] 2.2 Supertest suites: catalog (12), orders (7), payments (4), gateway (7)

## 3. Tracing

- [x] 3.1 Tracing bootstrap (HTTP, undici, pg) behind `OTEL_ENABLED`
- [x] 3.2 Trace context stored in the outbox (migration 002) and propagated through AMQP headers
- [x] 3.3 Unit test: request → outbox → publish → consume share one trace
- [x] 3.4 Jaeger compose profile and `make up-tracing`
- [x] 3.5 Verify: one order is one trace across four services in Jaeger

## 4. Accessibility and browser tests

- [x] 4.1 Playwright suite (29 tests) including a mobile viewport
- [x] 4.2 axe WCAG 2.1 AA on 7 pages in both themes
- [x] 4.3 Fix contrast tokens and respect reduced motion

## 5. Documentation

- [x] 5.1 README: API docs, tracing, test commands and counts
