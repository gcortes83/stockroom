## Why

"Products can also be imported from a csv", using the provided example file. That file is deliberately dirty, so the import must report every problem precisely, never let one bad row block the good ones, and be safe to re-run. The README must also state the download date.

## What Changes

- `POST /imports` (multipart) streams and validates the CSV row by row, upserts valid rows by SKU, and records a job with counters and line-numbered issues.
- Issue report as JSON (paginated, filterable) or a CSV download with spreadsheet-formula escaping.
- The example CSV is seeded once on first start.
- Studio UI: drag-and-drop upload with progress, import history and a data-quality report.

## Capabilities

### New Capabilities

- `product-import`: CSV format, row rules, duplicate handling, upsert semantics, reporting and seeding.

### Modified Capabilities

None.

## Impact

- Services: catalog. Bounded context: Catalog. API: `/imports`, `/imports/{id}`, `/imports/{id}/issues`.
- Database: `import_jobs`, `import_row_issues`.
- Data: `services/catalog/seed/example.csv` (downloaded 2026-10-05); profile in `docs/csv-data-profile.md`.

## Non-goals

- Asynchronous background processing (imports are synchronous but modelled as jobs).
- Spreadsheet formats other than CSV.

## Open questions / assumptions

- `$29.99` is normalized, an empty weight is accepted as null, an empty category is rejected, the last duplicate SKU wins, and existing SKUs are updated (ADR 0007).
