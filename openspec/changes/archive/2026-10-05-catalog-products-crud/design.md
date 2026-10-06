## Context

The catalog service owns products and stock (ADR 0004). See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:** correct money handling, safe concurrent edits, invariants enforced by the database.
**Non-Goals:** search (separate change) and CSV import (separate change).

## Decisions

- **Integer cents and grams** parsed with string arithmetic shared from `@stockroom/contracts`. Alternative: floats, rejected because of rounding errors.
- **Version column + ETag/If-Match**: `PUT` requires `If-Match`; the update is conditional on the version, so a stale write returns 409 with `currentVersion`. A missing header returns 428. Alternative: last-write-wins, rejected because it loses data silently.
- **Soft delete** with `deleted_at`. Deleting a product that has reserved stock is refused (409) so open checkouts are not broken.
- **Database constraints**: `UNIQUE(sku)`, `CHECK(price_cents >= 0)`, `CHECK(stock >= 0)`, `CHECK(reserved <= stock)`. These hold even if application code has a bug.
- **Categories**: `citext` name and a slug (`Home & Office` → `home-and-office`), inserted with `ON CONFLICT DO NOTHING`.

### Data model

`categories(id, name citext unique, slug unique)`; `products(id, sku unique, name, description, category_id, price_cents, currency, stock, reserved, weight_grams, version, created_at, updated_at, deleted_at)`.

### Alternatives considered

| Option | Trade-off |
|---|---|
| Fixed category enum | Simpler validation, but the CSV introduces new categories |
| PATCH with JSON merge | Smaller payloads, but harder to validate invariants; PUT keeps one schema |

## Risks / Trade-offs

- [A soft-deleted SKU blocks re-creation through the API] → a CSV re-import restores it; documented.
