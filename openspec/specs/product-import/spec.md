# product-import Specification

## Purpose
Lets admins load or update many products from a CSV file, with precise feedback about every row that could not be imported.

## Requirements

### Requirement: CSV format

The import SHALL accept a `.csv` file of up to 5 MB and 50,000 data rows. The required columns are `name, sku, description, category, price, stock, weight_kg`, in any order and case. Files with a BOM, CRLF line endings, quoted commas and escaped quotes are accepted.

#### Scenario: Missing columns
- **WHEN** a file lacks one or more required columns
- **THEN** the system responds `422` with code `CSV_INVALID_HEADER`, the missing columns and the job id, and writes no products

#### Scenario: Wrong file type
- **WHEN** a file without the `.csv` extension or with binary content is uploaded
- **THEN** the system responds `400` with code `UNSUPPORTED_FILE`

#### Scenario: Oversized file
- **WHEN** a file exceeds 5 MB
- **THEN** the system responds `413`

### Requirement: Row-level validation

Each row MUST be validated independently. Invalid rows are rejected with one issue per failing field, carrying the 1-based physical line number, SKU, field, raw value, code and message. Valid rows MUST still be imported.

#### Scenario: Dirty values in the example file
- **WHEN** rows contain price `free`, stock `-5`, an empty or whitespace-only name, or an empty category
- **THEN** those rows are rejected with codes `INVALID_PRICE`, `NEGATIVE_STOCK`, `NAME_REQUIRED` and `CATEGORY_REQUIRED` and the remaining rows are imported

#### Scenario: Normalized values
- **WHEN** a row has price `$29.99`, price `1,299.00` or an empty weight
- **THEN** the row is accepted with 2999 or 129900 cents and no weight

#### Scenario: Blank rows
- **WHEN** a row has only empty fields
- **THEN** it is skipped and counted as blank, not as an error

### Requirement: Duplicates and upserts

Within a file the last valid occurrence of an SKU SHALL win, with a `DUPLICATE_SKU_IN_FILE` warning. Rows whose SKU already exists MUST update the product; identical rows are counted as unchanged; soft-deleted SKUs are restored. A row that would set stock below the reserved units MUST be rejected with `STOCK_BELOW_RESERVED`.

#### Scenario: Example file imported into an empty catalog
- **WHEN** the example file is imported
- **THEN** the job reports 97 lines, 2 blank, 95 processed, 87 created, 5 rejected, 3 warnings and status `COMPLETED_WITH_ERRORS`

#### Scenario: Re-import is idempotent
- **WHEN** the same file is imported again
- **THEN** the job reports 0 created, 0 updated and 87 unchanged

### Requirement: Import reports

The system SHALL keep each import job with its status and counters, list jobs newest first, and return its issues as paginated JSON filterable by severity, or as a CSV attachment. Exported cells starting with `=`, `+`, `-`, `@`, tab or carriage return MUST be prefixed with `'`.

#### Scenario: Issue CSV is safe to open in a spreadsheet
- **WHEN** an admin downloads the issues of a job with stock `-5`
- **THEN** the cell is exported as `'-5`

### Requirement: First-start seeding

On first start with an empty catalog, the system SHALL import the example file once through the same pipeline and mark the job as seeded.

#### Scenario: Restart does not re-seed
- **WHEN** the catalog service restarts with existing products
- **THEN** no new seed job is created
