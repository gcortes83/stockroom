---
name: csv-import
description: CSV product import pipeline for Stockroom — streaming parse, header mapping, per-row validation and normalization (price, stock "string/int", weight_kg, category), upsert strategy by SKU, import jobs, error reporting and security limits. Use when building or testing the product CSV import feature.
---

# CSV Product Import

## Expected columns
`name, sku, description, category, price, stock, weight_kg`
Proposed types: name string · sku string · description string · category string/enum · price decimal · stock string/int · weight_kg decimal.
The "string/int" on stock is a hint that real data is dirty. Assume the example file contains messy rows and **inspect it before designing** (encoding, delimiter, quoting, BOM, empty lines, duplicates, numbers like `"1,299.00"`, `"10 units"`, negatives, blanks).

The example file (`Code Challenge E-Commerce.csv`) is profiled in **`docs/csv-data-profile.md`**: CRLF, no trailing newline, UTF-8 with `—`/`™`, `$29.99`, `free`, stock `-5`, empty and whitespace-only names, XSS and SQL-injection names, duplicate SKUs (RS-001 ×2, BS-021 ×3), empty weight, empty category, blank rows, quoted commas and escaped quotes. Read it before designing; its "Expected import result" (87 products, 5 rejected, 3 duplicate warnings with proposed defaults) is the integration-test oracle. Keep the profile and the rules below in sync with the decisions the user confirms.

## Pipeline
```
upload (multipart, ≤5 MB, .csv / text/csv) → ImportJob(PENDING)
  → stream parse (csv-parse, columns: true, bom: true, trim: true, relax_column_count: false)
  → header check (required columns present, case/space-insensitive, unknown columns reported)
  → per row: normalize → validate (zod rowSchema) → collect valid | record ImportRowError(row, field, value, message)
  → dedupe within file by normalized SKU (last wins or reject: decide, document)
  → batch upsert valid rows (500/tx) ON CONFLICT (sku)
  → ImportJob(COMPLETED | COMPLETED_WITH_ERRORS | FAILED) with counts
  → outbox ProductsImported event (optional)
```
- Never load the whole file into memory; never fail the whole import because of one bad row (unless headers are invalid).
- Row numbers in errors are 1-based file lines including header, so users can find them in a spreadsheet.

## Normalization rules (defaults — confirm with the user)
- `sku`: trim, uppercase, collapse internal spaces; required; `^[A-Z0-9][A-Z0-9-_]{1,63}$`.
- `name`: trim, required, ≤200 chars. `description`: trim, optional, ≤5000 chars.
- `category`: trim, case-insensitive match to known categories; unknown → error or auto-create (decide).
- `price`: strip currency symbols and thousands separators, parse with string math to cents; must be ≥0 with ≤2 decimals.
- `stock`: accept integers or numeric strings (`"12"`, `" 12 "`); reject non-integers, negatives, words; empty → error (or 0 — decide).
- `weight_kg`: decimal ≥0, up to 3 decimals → grams.

## Upsert semantics
- Default: upsert by SKU (create new, update existing fields). Re-running the same file is idempotent.
- Alternative: reject existing SKUs. Record the decision in an ADR and mention it in README.

## Sync vs async
- Small files (example CSV): processing within the request is fine but still create an ImportJob so the API is the same if it becomes async later. Document the threshold and the async path (queue worker) as future work or implement it if cheap.

## Security & limits
- Max size, max rows (e.g. 50k), reject binary content, CSV-injection: when exporting the error CSV, prefix cells starting with `= + - @` with `'`.
- Do not trust the client MIME type alone.

## Tests (must have)
- Fixtures in `services/catalog/test/fixtures/csv/`: valid, missing header, BOM, quoted commas, bad price, bad stock, duplicate SKUs in file, existing SKU update, empty file, oversized file.
- Property-style tests for price parsing (no float drift: `"0.1"+"0.2"` cases, `"19.99"` → 1999).
- The example CSV itself is an integration fixture; assert exact created/failed counts.
