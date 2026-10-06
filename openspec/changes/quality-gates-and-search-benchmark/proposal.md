## Why

Three items remain open in the implementation plan. Search performance is a stated target (p95 under 300 ms with 10,000 products) that has never been measured. Coverage is not enforced. There are no git hooks, so the "no code comments" rule and lint only run when someone remembers. Closing them turns the stated quality goals into checks.

## What Changes

- Search performance becomes a verified requirement, backed by a reproducible benchmark on a 10,000-product catalog.
- Coverage thresholds (80% lines on domain and application code) enforced in Vitest.
- Pre-commit hook (lint, no-comments audit, typecheck of staged workspaces) and Conventional Commits check on commit messages.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `product-search`: adds a measurable latency requirement.

## Impact

- catalog: benchmark script (generates a 10k-row CSV and imports it through the public API), `EXPLAIN ANALYZE` capture.
- Root tooling: `lefthook.yml`, `commitlint.config.mjs`, Vitest coverage configuration per workspace.
- README: benchmark results and hook setup.
- No API or data model changes. Covers `../../../docs/requeriments.txt`: "enterprise-grade" quality (implied).

## Non-goals

- CI pipelines (no remote CI is in scope).
- Changing the search engine; results only trigger ADR 0006's upgrade path if the target is missed.

## Open questions / assumptions

- The benchmark runs on the reviewer's laptop through Docker, so absolute numbers are indicative; the target is checked on the same machine before and after changes.
