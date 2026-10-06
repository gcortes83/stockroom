## Context

See proposal.md. These capabilities already exist; this change adds requirements to them.

## Goals / Non-Goals

**Goals:** docs that cannot drift from validation, traces that survive the outbox, enforced accessibility.
**Non-Goals:** per-service docs endpoints.

## Decisions

- **One OpenAPI document from the contracts**: `z.toJSONSchema` (input mode for request bodies, output mode for responses) plus a typed operation list, served statically by the gateway with `@fastify/swagger-ui`. A contract test checks route coverage; a Playwright test checks rendering under nginx's Content-Security-Policy.
- **Tracing**: the OpenTelemetry SDK starts before any other module (`import '@stockroom/platform/tracing'`) with HTTP, undici and pg instrumentations. `writeOutbox` stores the active W3C context in `outbox.trace_context`. The relay opens a PRODUCER span in that context and injects `traceparent` into the AMQP headers; consumers open a CONSUMER span from those headers. Auto-instrumenting amqplib was rejected because publishing happens at relay time, outside the request context, which would split traces.
- **Accessibility**: `--subtle` text moved to #8a86a9 (dark, 5.5:1) and #66638a (light, 5.2:1); light status colours darkened (warning #92400e, danger #be123c, success #047857, info #0e7490), each at least 4.5:1 on its tinted badge background. `MotionConfig reducedMotion="user"`. axe runs on 7 pages in both themes.

### Alternatives considered

| Option | Trade-off |
|---|---|
| Hand-written OpenAPI | Flexible, but drifts from the real validation |
| Per-service `/docs` aggregated by the gateway | Closer to service ownership, but needs runtime aggregation; one contracts package already describes the API |
| Always-on tracing | Simpler, but adds overhead and a required container |

## Risks / Trade-offs

- [Tracing SDK increases image size] → acceptable; services stay under 250 MB.
