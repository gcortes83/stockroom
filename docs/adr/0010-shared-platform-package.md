# 0010. Shared technical package `@stockroom/platform`

- Status: accepted
- Date: 2026-10-05

## Context

Every service needs the same config loading, logging, problem+json errors, request ids, migrations, outbox, broker and idempotent consumer code.

## Decision

Cross-cutting technical code lives in `packages/platform`; domain code never does. Services share only `@stockroom/contracts` and `@stockroom/platform`.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Copy per service | Total independence | Four copies of subtle reliability code |
| Separate published libraries | Independent versions | Overkill for one team in a monorepo |

## Consequences

Consistent behaviour across services; one place to fix reliability bugs.
