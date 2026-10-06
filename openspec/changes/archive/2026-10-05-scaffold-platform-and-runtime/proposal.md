## Why

Every feature of the challenge needs the same foundations: a monorepo that builds, a local stack that starts with one command, consistent HTTP errors, request ids and health checks. Building these first means each later change is a vertical slice instead of rework. It satisfies "The application must be runnable as a docker container", "Must use a local DB" and "Please add instructions on how to run the project locally" in `../../../../docs/requeriments.txt`.

## What Changes

- pnpm + Turborepo monorepo with `packages/contracts`, `packages/platform`, four NestJS services and the web app.
- `docker compose up --build` starts PostgreSQL 17, RabbitMQ, catalog, orders, payments, gateway and web, ordered by health checks.
- One database and role per service; migrations applied automatically at service start.
- Uniform `application/problem+json` errors, `x-request-id` propagation, structured JSON logs, and liveness and readiness endpoints.
- Gateway as the single public entry point under `/api/v1`, with security headers and rate limits; internal endpoints are never exposed.

## Capabilities

### New Capabilities

- `api-conventions`: error format, request ids, pagination envelope, validation errors, rate limiting and the public/internal API boundary.
- `local-runtime`: one-command local startup in Docker, configuration defaults, migrations and data reset.
- `observability`: health endpoints and structured, correlated logs.

### Modified Capabilities

None.

## Impact

- Services affected: all (gateway, catalog, orders, payments) and web. Bounded contexts: Edge, plus technical foundations shared by Catalog, Ordering and Payments.
- New infrastructure: PostgreSQL 17, RabbitMQ 4.3, nginx.
- Shared packages: `@stockroom/contracts` (schemas) and `@stockroom/platform` (technical cross-cutting code only).

## Non-goals

- Authentication and authorization (ADR 0009).
- Production deployment, Kubernetes, CI pipelines.

## Open questions / assumptions

- Assumed reviewers only have Docker installed; Node is optional for running the app.
- Fixed local credentials are acceptable because the stack is local-only.
