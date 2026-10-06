## Context

The example file was profiled before design (`docs/csv-data-profile.md`); its expected counts are the test oracle.

## Goals / Non-Goals

**Goals:** row-level errors with line numbers, idempotent re-import, bounded memory.
**Non-Goals:** partial-column updates.

## Decisions

- **Streaming parse** (RFC 4180, BOM, CRLF, quoted commas and quotes) with a guard against binary content and a 5 MB / 50,000-row limit.
- **Header normalization**: case and spaces are ignored and columns may come in any order. Any missing required column fails the job with 422 before anything is written.
- **Row rules** are pure functions shared with the tests: required fields, price parsed with string arithmetic (a leading `$` and thousands separators are accepted), stock as a non-negative integer, weight up to 3 decimals. Fully blank rows are skipped silently.
- **Duplicates in a file**: the last valid occurrence wins, and a warning is recorded on each replacing line.
- **Persistence** in batches of 500 per transaction. Existing SKUs are locked and classified as created, updated, unchanged or conflict (stock below reserved). A soft-deleted SKU is restored.
- **Seeding** runs once under an advisory lock when the catalog is empty, through the same import path.
- **Export** of issues escapes cells that start with `= + - @`, tab or carriage return.

### Alternatives considered

| Option | Trade-off |
|---|---|
| All-or-nothing import | Simple, but one bad row blocks the whole catalog |
| Reject existing SKUs | No accidental overwrite, but corrections become impossible |
| Asynchronous queue worker | Scales to huge files, but is unnecessary at 5 MB; the job model keeps that path open |

## Risks / Trade-offs

- [Synchronous request for large files] → size and row limits; the job resource is unchanged if processing becomes asynchronous.
