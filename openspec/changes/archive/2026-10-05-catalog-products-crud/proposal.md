## Why

Products are the core of the store and the first requirement: "CRUD for Products" with a UI. Admins need to manage the catalog safely while shoppers browse it, and concurrent edits must never silently overwrite each other.

## What Changes

- Catalog service: create, read, list, update and soft-delete products; list categories.
- Money stored as integer cents; weight as integer grams (ADR 0005).
- Categories created on first use, matched case-insensitively, with URL slugs.
- Optimistic concurrency with `ETag` / `If-Match`.
- SKUs normalized (trimmed, uppercase) and immutable after creation.

## Capabilities

### New Capabilities

- `product-catalog`: product lifecycle, validation, categories and concurrency rules.

### Modified Capabilities

None.

## Impact

- Services: catalog (owner), gateway (routes). Bounded context: Catalog.
- API: `GET/POST /products`, `GET/PUT/DELETE /products/{id}`, `GET /categories`.
- Database: `categories`, `products` tables in `catalog_db`.

## Non-goals

- Product images, variants, multi-currency.
- Hard deletes (orders keep snapshots, so products are soft-deleted).

## Open questions / assumptions

- SKUs are immutable after creation (assumption, README).
- Categories are dynamic rather than a fixed enum (assumption, README).
