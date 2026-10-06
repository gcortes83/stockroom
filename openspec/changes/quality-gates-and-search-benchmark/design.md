## Context

See proposal.md. NFR-PERF-01 in `docs/technical-specification.md` §21 defines the search target; tasks T1.7, T3.8 and T6.5 in `docs/implementation-plan.md` are the open items.

## Goals / Non-Goals

**Goals:** repeatable measurement, automatic enforcement on every commit.
**Non-Goals:** load testing the checkout saga.

## Decisions

- **Benchmark data through the public import API**: generate 10,000 rows (varied names, 18 categories, random prices) as a CSV and post it to `/api/v1/imports`. This exercises the real pipeline and avoids test-only database access.
- **Load tool: autocannon**, 50 connections for 30 s against a mix of queries (keyword, typo, category filter, price range). Report p50, p95 and p99, and keep the result in `docs/benchmarks/search.md`.
- **Query plan check**: `EXPLAIN (ANALYZE, BUFFERS)` for each query shape, asserting index use (GIN on `search_vector`, trigram on `name`).
- **Coverage**: `@vitest/coverage-v8` with thresholds applied to `src/**/domain/**` and `src/**/application/**`; reports in `coverage/`.
- **Hooks: lefthook** (parallel and fast) running `eslint` and `scripts/check-no-comments.sh` on staged files; commitlint with the conventional config. Alternative: husky + lint-staged, equivalent but more files.

### Alternatives considered

| Option | Trade-off |
|---|---|
| k6 for load testing | More features, but an extra binary; autocannon is a dev dependency |
| Seeding directly with SQL | Faster, but bypasses the import pipeline that real data goes through |

- **Planner costs tuned for SSD storage** (catalog migration `003`): `random_page_cost = 1.1`, `effective_io_concurrency = 200` on `catalog_db`. With the default cost of 4 (spinning disks), the planner chose a sequential scan for multi-word keyword searches. The tuned value lets it use a BitmapOr over the full-text and trigram indexes: 55 ms → 2.3 ms for "walnut lamp" on 10k products. Alternative: rewriting the query as a `UNION` of index-friendly branches, rejected as more complex for the same plan.
- **Benchmark runs with a raised gateway rate limit** (`RATE_LIMIT_PER_MINUTE`, now configurable in compose; default unchanged at 300). Otherwise 50 connections from one IP would measure 429 responses instead of search latency.

- **Load generated inside the compose network** (`scripts/bench/load.mjs` in a `node:24-alpine` container on `stockroom_default`), still through nginx → gateway → catalog. Generating it from the macOS host went through Docker Desktop's port forwarding, which collapsed under connection churn (16 req/s and 502s). `--load-from-host` keeps the original mode.
- **nginx keep-alive upstream with DNS re-resolution** (found by the benchmark): nginx opened a new connection per request and exhausted ephemeral ports (`connect() failed (99: Address not available)`) at about 1,500 req/s. It also kept a stale gateway IP after the gateway container was recreated, returning 502 until nginx restarted. Fixed with `upstream { zone; server gateway:3000 resolve; keepalive 64; }` and the Docker resolver. Verified: 0 errors at about 1,700 req/s, and immediate recovery after recreating the gateway.

## Risks / Trade-offs

- [Laptop noise skews latency] → warm-up run, 3 repetitions, report the median of p95.
- [Hooks slow down commits] → only staged files are checked; a full typecheck stays in `pnpm typecheck`.
