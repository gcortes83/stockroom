## 1. Search benchmark (catalog)

- [x] 1.1 Script that generates a 10,000-row CSV with realistic variety
- [x] 1.2 Import it through `POST /api/v1/imports` and assert 10,000 created
- [x] 1.3 autocannon scenario (50 connections, 30 s, mixed queries) with p50/p95/p99 output
- [x] 1.4 Capture `EXPLAIN (ANALYZE, BUFFERS)` per query shape and confirm index use
- [x] 1.5 Record the results in `docs/benchmarks/search.md`; if p95 ≥ 300 ms, open a follow-up change per ADR 0006
- [x] 1.6 Verify: p95 < 300 ms on the reference machine

## 2. Coverage thresholds

- [x] 2.1 Add `@vitest/coverage-v8` and coverage config to contracts, platform and each service
- [x] 2.2 Enforce 80% line coverage on domain and application code
- [x] 2.3 Verify: `pnpm test:coverage` passes, and fails when the threshold is set above actual coverage

## 3. Git hooks

- [x] 3.1 `lefthook.yml`: pre-commit runs ESLint and the no-comments audit on staged files
- [x] 3.2 commitlint with Conventional Commits on commit-msg
- [x] 3.3 Verify: a commit with a code comment or a non-conventional message is rejected

## 4. Documentation

- [x] 4.1 README: benchmark results, coverage command and hook setup
- [x] 4.2 Implementation plan: close T1.7, T3.8 and T6.5
