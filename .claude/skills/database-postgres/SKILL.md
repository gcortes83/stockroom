---
name: database-postgres
description: Database design for Stockroom — PostgreSQL 17 with node-postgres and SQL migrations, database-per-service, schema conventions, migrations, indexing, full-text and trigram search, money/decimal handling, stock concurrency, outbox/idempotency tables and seeding. Use when modeling data, writing migrations or queries, or tuning search.
---

# Databases — PostgreSQL + node-postgres

## Layout
- One Postgres container locally; databases `catalog_db`, `orders_db`, `payments_db`, each with its own user (created by `infra/postgres/init.sql`). A service's credentials can only reach its own DB.
- Each service owns `migrations/NNN_name.sql`. `runMigrations` (platform) applies them at start under an advisory lock and records them in `schema_migrations`. Repositories use parameterized `pg` queries only.
- Never edit an applied migration; add a new one.

## Conventions
- Tables snake_case plural (`products`), columns snake_case ; TypeScript row types mirror columns and are mapped to camelCase DTOs in repositories.
- PK `id uuid` (v7 generated in app). `created_at`, `updated_at timestamptz not null`.
- `version int not null default 1` on mutable aggregates for optimistic locking.
- Soft delete only when there is a reason (products referenced by orders → `deleted_at`; orders keep a snapshot anyway).
- Constraints in the DB, not only in code: `NOT NULL`, `UNIQUE`, `CHECK (stock >= 0)`, `CHECK (price_cents >= 0)`.

## Catalog model (starting point)
```
products(id, sku UNIQUE (citext or normalized upper), name, description, category, price_cents bigint,
         currency char(3), stock int CHECK >= 0, reserved int CHECK >= 0, weight_grams int,
         search_vector tsvector GENERATED, version, created_at, updated_at, deleted_at)
stock_reservations(id, order_id UNIQUE per sku, product_id, quantity, status, expires_at)
import_jobs(id, filename, status, total_rows, created, updated, failed, started_at, finished_at)
import_row_errors(id, job_id, row_number, field, value, message)
outbox(id, aggregate_type, aggregate_id, type, payload jsonb, occurred_at, published_at)
processed_messages(message_id PK, processed_at)
```
- Category: start as a constrained text/enum; decide in an ADR whether categories are a table (dynamic from CSV) or enum (fixed). CSV says "string/enum" — ask the user.
- Weight: CSV gives `weight_kg` decimal; store as integer grams or `NUMERIC(10,3)`. Decide and document.

## Money
- Store `price_cents BIGINT` (or `NUMERIC(12,2)`), never `float`/`real`/`double`. Parse CSV decimals with string math (e.g. split on `.`), not `parseFloat`.
- Orders store `unit_price_cents` snapshot and `total_cents` computed server-side.

## Concurrency — no overselling
```sql
UPDATE products SET stock = stock - $qty, version = version + 1
WHERE id = $id AND stock - reserved >= $qty AND deleted_at IS NULL;
```
Check `rowCount = 1`; otherwise `InsufficientStock`. Use parameterized `pg` queries (`$1, $2`), never string interpolation of values. For multi-line orders, lock rows in a deterministic order (sorted by id) inside one transaction to avoid deadlocks. Write a concurrency test that fires N parallel purchases for the last unit and asserts exactly one wins.

## Search
- Default: `search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(name,'')),'A') || setweight(to_tsvector('simple', coalesce(sku,'')),'A') || setweight(to_tsvector('english', coalesce(description,'')),'B')) STORED` with a GIN index.
- `pg_trgm` GIN index on `name` and `sku` for typo tolerance / prefix search (`ILIKE`, `similarity`).
- Query: `websearch_to_tsquery` + trigram fallback, rank with `ts_rank`, filter by category/price/in-stock, keyset or offset pagination (offset fine at this size; document).
- The generated tsvector column, GIN and trigram indexes live in the SQL migration.
- Alternatives to document: Meilisearch/Typesense/OpenSearch (better relevance, extra container + sync pipeline). Postgres FTS is enough for thousands–low millions of rows.

## Indexes
- Unique on normalized `sku`. B-tree on `(category)`, `(price_cents)`, `(created_at desc, id)`. GIN on `search_vector`, trigram on `name`.
- Outbox: partial index `WHERE published_at IS NULL`.
- Run `EXPLAIN ANALYZE` on search queries with seeded data before claiming performance.

## CSV import at the DB level
- Batch upserts (`INSERT ... ON CONFLICT (sku) DO UPDATE`) in chunks of ~500 inside transactions; never one transaction for the whole file and never one round-trip per row.

## Seeding
- The catalog `SeedingService` loads the example CSV through the same import use case (proves the pipeline) when the DB is empty.
