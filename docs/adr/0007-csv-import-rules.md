# 0007. CSV import: per-row validation, last-wins dedupe, upsert by SKU

- Status: accepted
- Date: 2026-10-05

## Context

The example CSV is deliberately dirty: currency symbols, `free` prices, negative stock, empty names, duplicate SKUs, blank rows, hostile text.

## Decision

Stream-parse, validate each row independently, report every failing field with its line number, skip blank rows, keep the last occurrence of a duplicate SKU with a warning, then upsert by SKU in batches of 500 classifying rows as created/updated/unchanged. A missing header fails the job with 422. Imports are synchronous but modelled as jobs.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| All-or-nothing import | Simple semantics | One bad row blocks the whole catalog |
| Reject existing SKUs | No accidental overwrites | Makes re-imports impossible; corrections need manual edits |

## Consequences

Re-importing is idempotent (87 unchanged). Users get a downloadable issue report with formula-injection protection.
