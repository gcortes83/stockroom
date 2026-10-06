# Stockroom — Technical Specification

| | |
|---|---|
| Version | 0.3 — implemented. Adds §22 implementation notes (deviations from 0.2 found while building) |
| Date | 2026-10-05 |
| Status | Draft. Decisions marked ⚠️ use the proposed default from `docs/use-cases.md` and are confirmed in Phase 0 (T0.1). |
| Inputs | `requeriments.txt`, `docs/use-cases.md`, `docs/csv-data-profile.md`, `docs/implementation-plan.md`, `docs/adr/` |

---

## Table of contents

1. Scope and goals
2. Architecture overview
3. Repository structure
4. Cross-cutting conventions
5. Service: gateway
6. Service: catalog
7. Service: orders
8. Service: payments
9. Messaging and the checkout saga
10. Public REST API reference
11. Error catalog
12. Frontend (apps/web)
13. Runtime, configuration and deployment
14. Security
15. Observability and operations
16. Performance targets and limits
17. Testing specification
18. Traceability
19. Assumptions and open decisions
20. Technology stack decisions
21. Non-functional requirements and mitigations
22. Implementation notes

---

## 1. Scope and goals

### 1.1 Functional scope

| Req | Capability | Use cases |
|---|---|---|
| R1 | Local database | — |
| R2 | Products CRUD | UC-01, UC-03, UC-04, UC-05, UC-06 |
| R3 | CSV product import | UC-07, UC-08, UC-15 |
| R4 | Product search | UC-02 |
| R5 | Purchase with fake payment | UC-09, UC-10, UC-11, UC-12, UC-13, UC-14 |
| R6 | UI for CRUD, search and purchase | all shopper and admin use cases |
| R7 | Runnable with Docker | — |

### 1.2 Quality goals (priority order)

1. **Correctness of stock and money.** No overselling under concurrency. No floating-point money. Purchases are idempotent.
2. **Import integrity.** Each row succeeds or fails on its own. Errors are reported precisely. Re-importing is safe.
3. **One-command local run.** `docker compose up --build` gives a working, seeded system.
4. **Evolvability.** Explicit service boundaries, versioned contracts, documented decisions.
5. **Operability.** Health checks, structured logs, a correlation id across HTTP and messages.

These goals are broken down into measurable non-functional requirements, each with its mitigations and verification, in §21.

### 1.3 Out of scope

Authentication and user accounts ⚠️, shipping and addresses, taxes, multi-currency, real payment providers, product images, multi-warehouse inventory, refunds UI, i18n.

---

## 2. Architecture overview

### 2.1 Context (C4 level 1)

```mermaid
flowchart LR
  Admin((Admin)) -->|manages catalog, imports CSV| SR[Stockroom]
  Shopper((Shopper)) -->|searches, buys| SR
  SR -->|simulated charge| FP[Fake payment provider<br/>inside Stockroom]
```

### 2.2 Containers (C4 level 2)

```mermaid
flowchart TB
  subgraph Browser
    WEB[apps/web<br/>React SPA]
  end
  subgraph docker-compose network
    NGINX[web: nginx :80<br/>static + /api proxy]
    GW[gateway :3000<br/>NestJS]
    CAT[catalog :3001<br/>NestJS]
    ORD[orders :3002<br/>NestJS]
    PAY[payments :3003<br/>NestJS]
    PG[(postgres :5432<br/>catalog_db / orders_db / payments_db)]
    MQ{{rabbitmq :5672<br/>exchange stockroom.events}}
  end
  WEB -->|HTTPS/HTTP :8080| NGINX
  NGINX -->|/api/*| GW
  GW -->|/api/v1/products,categories,imports| CAT
  GW -->|/api/v1/orders| ORD
  GW -->|/api/v1/payments/methods| PAY
  ORD -->|GET /internal/v1/products/snapshot| CAT
  CAT <-->|events| MQ
  ORD <-->|events| MQ
  PAY <-->|events| MQ
  CAT --> PG
  ORD --> PG
  PAY --> PG
```

### 2.3 Service responsibilities

| Service | Owns (single writer) | Exposes | Consumes |
|---|---|---|---|
| gateway | nothing (stateless) | Public `/api/v1/*`, `/api/docs` | HTTP from web |
| catalog | categories, products, stock, reservations, import jobs | Products, categories and imports APIs; internal snapshot API | `orders.order.created/confirmed/cancelled` |
| orders | orders, order lines, status history | Orders API | `catalog.stock.*`, `payments.payment.*` |
| payments | payment methods, payments | Payment methods API | `payments.charge.requested`, `payments.refund.requested` |

### 2.4 Communication rules

- Browser → gateway → one service: synchronous HTTP/JSON.
- orders → catalog price/availability snapshot at order placement: synchronous HTTP with a timeout, retries and a circuit breaker. This is the only service-to-service HTTP call.
- All state changes that span services use asynchronous events over RabbitMQ, published through a transactional outbox.
- Services never read another service's database.

### 2.5 Key design decisions (ADR index)

Architecture-level decisions are listed below. Library and tooling decisions (TD-01 to TD-18) are in §20.

| ADR | Decision | Main alternative rejected |
|---|---|---|
| 0001 | Microservices in a pnpm monorepo | Modular monolith |
| 0002 | PostgreSQL 17 + node-postgres + SQL migrations, one database per service | Prisma; MongoDB; schema-per-service; TypeORM/Drizzle |
| 0003 | RabbitMQ + transactional outbox + idempotent consumers | Kafka; Redis Streams; direct publish |
| 0004 | Orchestrated saga in orders; inventory inside catalog | Choreography; separate inventory service |
| 0005 | Money as integer cents (BIGINT); weight as integer grams | NUMERIC everywhere; floats |
| 0006 | PostgreSQL FTS + pg_trgm | Meilisearch / OpenSearch |
| 0007 | CSV import: per-row validation, last-wins dedupe, upsert by SKU | All-or-nothing import; reject existing SKUs |
| 0008 | React 19 + Vite + TanStack Query + shadcn/ui | Next.js; Redux |
| 0009 | No authentication; admin and shop areas split by route ⚠️ | Basic auth; JWT with seeded users |
| 0010 | `packages/platform` for technical cross-cutting code | Duplicated code per service |
| 0011 | Payment method tokenization in payments; no card data in orders or events | Sending card numbers in the order request and events |

---

## 3. Repository structure

```
stockroom/
├── apps/
│   └── web/
│       ├── src/{app,features,shared}/
│       ├── e2e/                       Playwright specs
│       ├── nginx.conf
│       └── Dockerfile
├── services/
│   ├── gateway/
│   ├── catalog/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── config/
│   │   │   └── modules/
│   │   │       ├── products/{domain,application,infrastructure,interface}/
│   │   │       ├── categories/...
│   │   │       ├── imports/...
│   │   │       ├── inventory/...
│   │   │       └── seeding/...
│   │   ├── migrations/NNN_name.sql
│   │   ├── seed/example.csv
│   │   ├── test/{fixtures,integration,http}/
│   │   └── Dockerfile
│   ├── orders/                        same layout
│   └── payments/                      same layout
├── packages/
│   ├── contracts/                     zod schemas: http DTOs, events, problem details, money
│   ├── platform/                      config, logger, correlation, problem filter, health, outbox, amqp, idempotent consumer
│   ├── tsconfig/
│   └── eslint-config/
├── infra/
│   └── postgres/init.sql
├── docs/{adr/,architecture.md,use-cases.md,csv-data-profile.md,implementation-plan.md,technical-specification.md}
├── openspec/
├── scripts/{smoke.sh,check-no-comments.sh}
├── docker-compose.yml
├── compose.override.yml               optional dev hot-reload
├── .env.example
├── package.json  pnpm-workspace.yaml  turbo.json  .nvmrc
└── README.md
```

Package names: `@stockroom/web`, `@stockroom/gateway`, `@stockroom/catalog`, `@stockroom/orders`, `@stockroom/payments`, `@stockroom/contracts`, `@stockroom/platform`, `@stockroom/tsconfig`, `@stockroom/eslint-config`.

---

## 4. Cross-cutting conventions

### 4.1 Language and tooling

| Item | Choice |
|---|---|
| Runtime | Node.js 24 LTS (`node:24-alpine` images) |
| Language | TypeScript 5.x, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Package manager | pnpm (pinned with `packageManager`), Turborepo for task orchestration |
| Backend framework | NestJS 11, Fastify adapter (rationale in §20) |
| Data access | node-postgres (`pg`) with parameterized SQL in repository adapters; plain `.sql` migrations applied at boot (TD-05) |
| Validation | zod schemas in `@stockroom/contracts`, applied with nestjs-zod |
| Logging | pino through nestjs-pino |
| Tests | Vitest, Testcontainers, Supertest, Testing Library, MSW, Playwright, fast-check |
| Lint and format | ESLint (typescript-eslint strict), Prettier |
| Commits | Conventional Commits, enforced by commitlint |

### 4.2 Code rules

- **No comments in source files** (challenge rule). Enforced by an ESLint rule and by `scripts/check-no-comments.sh` in the pre-commit hook. The only exception is required tool directives such as `/// <reference types="vite/client" />`.
- No `any`. No non-null assertions. No `console.*`; use the logger.
- Hexagonal layering per module. `domain` imports nothing from NestJS or `pg`.
- Files in kebab-case, classes in PascalCase. Use case classes end in `UseCase`; ports are interfaces with an injection token.

### 4.3 Identifiers

- All entity ids are UUID v7, generated by the application through `IdGenerator` (injectable, for tests).
- Event ids are UUID v7.
- Payment method ids are `pm_` followed by 24 base62 characters.

### 4.4 Money

- Domain: `Money { amountCents: bigint-safe integer (number ≤ 2^53), currency: 'USD' }`. Single currency ⚠️.
- Database: `BIGINT` columns ending in `_cents`.
- Wire: `{ "amountCents": 1999, "currency": "USD" }` in responses. Request bodies use `priceCents: integer`.
- Parsing decimal strings (CSV and UI input) uses `parseMoney(input: string): Result<number, MoneyError>` in `@stockroom/contracts`, built only on string operations:
  1. Trim. Strip one leading `$` or `USD` prefix and surrounding spaces.
  2. Remove `,` thousands separators, only when they match `^\d{1,3}(,\d{3})+(\.\d+)?$`.
  3. Must match `^\d+(\.\d{1,2})?$`. Anything else fails with `INVALID_PRICE`.
  4. cents = integer part × 100 + fraction padded to 2 digits. Reject if greater than `MAX_PRICE_CENTS` (99,999,999).
- Formatting in the UI uses `Intl.NumberFormat('en-US', { style: 'currency', currency })` on `amountCents / 100`. Display only; the UI never computes money with floats.

### 4.5 Weight

- Stored as `weight_grams INTEGER NULL`. Parsed from `weight_kg` with string math: up to 3 decimals, ≥ 0, ≤ 1,000,000 g.
- Wire: `weightGrams: number | null`. The UI shows kg with up to 3 decimals.

### 4.6 Time

- All timestamps are `timestamptz` in UTC, ISO-8601 with `Z` on the wire.
- `Clock` port injected everywhere so tests control time.

### 4.7 Text normalization

| Field | Normalization | Validation |
|---|---|---|
| sku | trim, uppercase, collapse internal whitespace to `-` | `^[A-Z0-9][A-Z0-9_-]{1,63}$` |
| name | trim, collapse runs of whitespace | 1–200 characters after trim |
| description | trim | 0–5000 characters |
| category | trim, collapse whitespace; matched case-insensitively | 1–60 characters |
| email | trim, lowercase | RFC 5322 basic (zod `email()`) |

Text is stored literally. Markup or SQL-looking content is never sanitized on input; safety comes from parameterized queries and output encoding (see §14).

### 4.8 HTTP conventions

- JSON bodies use camelCase.
- `Content-Type: application/json`. Errors use `application/problem+json`.
- The request id header is `x-request-id`. The gateway generates one if it is missing and echoes it in responses.
- Pagination envelope: `{ "data": [...], "page": { "page": 1, "pageSize": 20, "totalItems": 87, "totalPages": 5 } }`.
- `page` ≥ 1, default 1. `pageSize` between 1 and 100, default 20.
- Unknown query parameters are ignored. Invalid values return 400.

---

## 5. Service: gateway

### 5.1 Responsibilities

- Routes public requests to services. Contains no business logic.
- Cross-cutting edge concerns: request id, CORS, helmet headers, rate limiting, body size limits, access logging, OpenAPI aggregation.

### 5.2 Routing table

| Public path | Methods | Upstream | Body limit |
|---|---|---|---|
| `/api/v1/products` and `/api/v1/products/:id` | GET, POST, PUT, DELETE | `CATALOG_URL` | 64 KB |
| `/api/v1/categories` | GET | `CATALOG_URL` | — |
| `/api/v1/imports` and below | GET, POST | `CATALOG_URL` | 5 MB (multipart) |
| `/api/v1/orders` and below | GET, POST | `ORDERS_URL` | 64 KB |
| `/api/v1/payments/methods` | POST | `PAYMENTS_URL` | 4 KB |
| `/api/docs` | GET | aggregated OpenAPI | — |
| `/health/live`, `/health/ready` | GET | local (ready = upstreams' ready) | — |

`/internal/*` paths are never routed. The upstream path is the public path without the `/api` prefix (for example `/v1/products`).

### 5.3 Implementation

- `@fastify/http-proxy` registered per route prefix (streaming, so multipart uploads are not buffered), with a 5 s upstream timeout (TD-09). Upstream failures map to 502 and timeouts to 504, both as problem+json.
- Forwarded headers: `x-request-id`, `idempotency-key`, `if-match`, `content-type`, `accept`.
- Response headers passed through: `etag`, `location`, `idempotent-replayed`.

### 5.4 Rate limits (`@fastify/rate-limit`, per client IP and bucket)

| Scope | Limit |
|---|---|
| Default | 300 requests per minute |
| `POST /api/v1/imports` | 10 per minute |
| `POST /api/v1/orders` | 30 per minute |
| `POST /api/v1/payments/methods` | 30 per minute |

Exceeding a limit returns 429 with a `Retry-After` header.

### 5.5 CORS and headers

- With the nginx proxy, the browser stays same-origin, so CORS only matters for `pnpm dev`. Allowed origin: `WEB_ORIGIN` (default `http://localhost:5173`).
- `@fastify/helmet` defaults with `crossOriginResourcePolicy: same-site`; CORS through `@fastify/cors`.

---

## 6. Service: catalog

### 6.1 Modules

| Module | Responsibility |
|---|---|
| products | Product aggregate, CRUD, search |
| categories | Category lookup and creation |
| imports | CSV parsing, validation, upsert, import jobs, error reports |
| inventory | Reservations, commit/release, expiry sweeper, saga consumers |
| seeding | First-start import of the example CSV |
| shared | Outbox, processed messages, health |

### 6.2 Domain model

```mermaid
classDiagram
  class Product {
    id: UUID
    sku: Sku
    name: string
    description: string
    categoryId: UUID
    price: Money
    stock: int
    reserved: int
    weightGrams: int?
    version: int
    deletedAt: Instant?
    available() int
    changeDetails(...)
    changeStock(newStock)
    reserve(qty)
    commit(qty)
    release(qty)
  }
  class Category { id; name; slug }
  class StockReservation { id; orderId; productId; quantity; status; expiresAt }
  class ImportJob { id; filename; status; totals; startedAt; finishedAt }
  class ImportRowIssue { line; sku; field; value; code; message; severity }
  Product --> Category
  StockReservation --> Product
  ImportJob "1" --> "*" ImportRowIssue
```

Invariants:
- `0 ≤ reserved ≤ stock`; `available = stock − reserved`.
- `priceCents ≥ 0`, `stock ≥ 0`, `weightGrams ≥ 0` or null.
- `sku` is unique across all products, including soft-deleted ones, and immutable after creation ⚠️.
- A soft-deleted product cannot be reserved, updated or listed.

### 6.3 Database schema (`catalog_db`)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE categories (
  id          uuid PRIMARY KEY,
  name        citext NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id            uuid PRIMARY KEY,
  sku           text NOT NULL UNIQUE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  category_id   uuid NOT NULL REFERENCES categories(id),
  price_cents   bigint NOT NULL CHECK (price_cents >= 0),
  currency      char(3) NOT NULL DEFAULT 'USD',
  stock         integer NOT NULL CHECK (stock >= 0),
  reserved      integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  weight_grams  integer NULL CHECK (weight_grams IS NULL OR weight_grams >= 0),
  version       integer NOT NULL DEFAULT 1,
  search_vector tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(sku, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(description, '')), 'B')
                ) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz NULL,
  CONSTRAINT reserved_not_above_stock CHECK (reserved <= stock)
);

CREATE INDEX products_search_vector_idx ON products USING gin (search_vector);
CREATE INDEX products_name_trgm_idx     ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_sku_trgm_idx      ON products USING gin (sku gin_trgm_ops);
CREATE INDEX products_category_idx      ON products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_price_idx         ON products (price_cents) WHERE deleted_at IS NULL;
CREATE INDEX products_created_idx       ON products (created_at DESC, id) WHERE deleted_at IS NULL;

CREATE TYPE reservation_status AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');

CREATE TABLE stock_reservations (
  id          uuid PRIMARY KEY,
  order_id    uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  status      reservation_status NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id)
);
CREATE INDEX stock_reservations_expiry_idx ON stock_reservations (expires_at) WHERE status = 'RESERVED';
CREATE INDEX stock_reservations_order_idx  ON stock_reservations (order_id);

CREATE TYPE import_status AS ENUM ('PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');
CREATE TYPE issue_severity AS ENUM ('ERROR', 'WARNING');

CREATE TABLE import_jobs (
  id               uuid PRIMARY KEY,
  filename         text NOT NULL,
  size_bytes       integer NOT NULL,
  status           import_status NOT NULL,
  source           text NOT NULL DEFAULT 'UPLOAD',
  total_lines      integer NOT NULL DEFAULT 0,
  blank_lines      integer NOT NULL DEFAULT 0,
  processed_rows   integer NOT NULL DEFAULT 0,
  created_count    integer NOT NULL DEFAULT 0,
  updated_count    integer NOT NULL DEFAULT 0,
  unchanged_count  integer NOT NULL DEFAULT 0,
  rejected_count   integer NOT NULL DEFAULT 0,
  warning_count    integer NOT NULL DEFAULT 0,
  failure_message  text NULL,
  started_at       timestamptz NOT NULL,
  finished_at      timestamptz NULL
);
CREATE INDEX import_jobs_started_idx ON import_jobs (started_at DESC);

CREATE TABLE import_row_issues (
  id          uuid PRIMARY KEY,
  job_id      uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  line        integer NOT NULL,
  sku         text NULL,
  field       text NULL,
  value       text NULL,
  code        text NOT NULL,
  message     text NOT NULL,
  severity    issue_severity NOT NULL
);
CREATE INDEX import_row_issues_job_idx ON import_row_issues (job_id, line);

CREATE TABLE outbox (
  id              uuid PRIMARY KEY,
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  correlation_id  uuid NOT NULL,
  causation_id    uuid NULL,
  occurred_at     timestamptz NOT NULL,
  published_at    timestamptz NULL,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text NULL
);
CREATE INDEX outbox_unpublished_idx ON outbox (occurred_at) WHERE published_at IS NULL;

CREATE TABLE processed_messages (
  message_id    uuid PRIMARY KEY,
  consumer      text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);
```

This DDL is the literal content of `services/catalog/migrations/001_init.sql`. Repositories map snake_case rows to camelCase DTOs.

### 6.4 Products: use cases

| Use case | Input | Behavior | Errors |
|---|---|---|---|
| CreateProduct | sku, name, description?, category, priceCents, stock, weightGrams? | Normalize, resolve or create the category, insert with version 1 | `VALIDATION`, `DUPLICATE_SKU` |
| GetProduct | id | Returns the product unless soft-deleted | `PRODUCT_NOT_FOUND` |
| ListProducts | filters, sort, page | See §6.6 | `VALIDATION` |
| UpdateProduct | id, expectedVersion, name, description, category, priceCents, stock, weightGrams | Rejects if stock < reserved; increments version | `PRODUCT_NOT_FOUND`, `VERSION_CONFLICT`, `STOCK_BELOW_RESERVED`, `VALIDATION` |
| DeleteProduct | id | Soft delete (`deleted_at = now()`, version + 1); rejects if `reserved > 0` | `PRODUCT_NOT_FOUND`, `PRODUCT_HAS_ACTIVE_RESERVATIONS` |
| ListCategories | — | All categories with active product counts, sorted by name | — |

Optimistic update:

```sql
UPDATE products
SET name = $name, description = $description, category_id = $categoryId,
    price_cents = $priceCents, stock = $stock, weight_grams = $weightGrams,
    version = version + 1, updated_at = now()
WHERE id = $id AND version = $expectedVersion AND deleted_at IS NULL AND $stock >= reserved
RETURNING *;
```

If no row is returned, the use case re-reads the product to tell apart not found (404), version mismatch (409 `VERSION_CONFLICT`) and stock below reserved (409 `STOCK_BELOW_RESERVED`).

### 6.5 Categories

- Dynamic ⚠️. A category is created on first use (create, update or import).
- Lookup is case-insensitive (`citext`). The display name comes from the first occurrence.
- `slug` is lowercased, with `&` replaced by `and` and non-alphanumerics replaced by `-`. Examples: `home-and-office`, `food-and-beverage`.
- The example CSV yields 17 categories. `Misc` appears only on the rejected WS-001 row.

### 6.6 Search

Query parameters are listed in §10.2. SQL template (parameters bound positionally with `pg`; ORDER BY comes from a whitelist):

```sql
WITH q AS (
  SELECT websearch_to_tsquery('english', $q) AS tsq, $q::text AS raw
)
SELECT p.*, c.name AS category_name, c.slug AS category_slug,
       CASE WHEN $q = '' THEN 0
            ELSE ts_rank_cd(p.search_vector, q.tsq) * 2
               + greatest(similarity(p.name, q.raw), similarity(p.sku, upper(q.raw)))
               + CASE WHEN p.sku = upper(q.raw) THEN 10 ELSE 0 END
       END AS score,
       count(*) OVER () AS total_items
FROM products p
JOIN categories c ON c.id = p.category_id
CROSS JOIN q
WHERE p.deleted_at IS NULL
  AND ($q = '' OR p.search_vector @@ q.tsq
               OR p.name % q.raw
               OR p.sku ILIKE upper(q.raw) || '%')
  AND (cardinality($categorySlugs::text[]) = 0 OR c.slug = ANY($categorySlugs))
  AND ($minPriceCents::bigint IS NULL OR p.price_cents >= $minPriceCents)
  AND ($maxPriceCents::bigint IS NULL OR p.price_cents <= $maxPriceCents)
  AND (NOT $inStock OR p.stock - p.reserved > 0)
ORDER BY <whitelisted sort>, p.id
LIMIT $pageSize OFFSET ($page - 1) * $pageSize;
```

- Sort whitelist:
  - `relevance` → `score DESC, created_at DESC`. Falls back to `newest` when `q` is empty.
  - `price_asc` → `price_cents ASC`
  - `price_desc` → `price_cents DESC`
  - `name_asc` → `name ASC`
  - `newest` → `created_at DESC`
- The trigram similarity threshold is set per transaction with `SET LOCAL pg_trgm.similarity_threshold = 0.3`.
- `q` is trimmed and limited to 100 characters. An empty `q` means a plain list.
- Pagination uses offset, which is acceptable up to about 10k rows (ADR 0006). Keyset pagination is listed as future work.

Expected behavior on the example data:

| Query | Expectation |
|---|---|
| `bluetooth` | BS-021, BS-099, SS-022 (name matches) rank above description-only matches |
| `bluetoth` | Speakers still returned through the trigram match on name |
| `RS-0` | RS-001 and RS-050 (SKU prefix) |
| `rs-001` | RS-001 first (exact SKU boost) |
| `category=home-and-office` | 13 products (DL-007 is rejected) |
| `<script>` | Treated as text; returns XS-001 if it matches, never errors |

### 6.7 CSV import

#### 6.7.1 Endpoint contract
- `POST /v1/imports`, `multipart/form-data`, field `file`.
- Limits: 5 MB and 50,000 data lines. Extension `.csv`. The content is sniffed: the first 4 KB must be valid UTF-8 with no NUL bytes.
- Processing is synchronous within the request (ADR 0007). The example file takes well under 1 s.
- Returns 201 with the final `ImportJob` and a `Location: /v1/imports/:id` header.
- Switching to asynchronous processing later (202 plus polling) keeps the same resource shape ⚠️.

#### 6.7.2 Pipeline

```mermaid
flowchart LR
  U[Upload] --> V{size/ext/<br/>utf-8 ok?}
  V -- no --> E400[400/413 problem]
  V -- yes --> J[Create ImportJob PROCESSING]
  J --> P[csv-parse stream<br/>bom, CRLF, relax_quotes:false]
  P --> H{header valid?}
  H -- no --> F[Job FAILED<br/>422 problem]
  H -- yes --> R[Per row: blank? → skip<br/>normalize → validate]
  R --> D[Dedupe by SKU in file<br/>last wins + WARNING]
  D --> B[Batches of 500:<br/>classify + upsert in tx]
  B --> C[Job COMPLETED or<br/>COMPLETED_WITH_ERRORS]
```

- Parser options: `columns: header => normalizedHeader`, `bom: true`, `trim: false` (fields are trimmed per rule), `skip_empty_lines: true`, `relax_column_count: false`, `max_record_size: 20000`.
- Header normalization: lowercase, trim, spaces become `_`. The required set is exactly `name, sku, description, category, price, stock, weight_kg`. Column order does not matter. Unknown extra columns produce a single job-level WARNING and are ignored. A missing required column fails the job with 422 `CSV_INVALID_HEADER` and writes nothing.
- A blank line is a record whose fields are all empty after trimming. It counts in `blank_lines` and is not an issue.
- Line numbers are 1-based physical lines with the header as line 1, matching spreadsheets.
- A record with the wrong column count gives a row ERROR `CSV_MALFORMED_ROW`, and parsing continues.

#### 6.7.3 Row rules

| Field | Rule | Error code |
|---|---|---|
| name | required after trim and whitespace collapse, ≤ 200 characters | `NAME_REQUIRED`, `NAME_TOO_LONG` |
| sku | required, normalized (§4.7), matches the pattern | `SKU_REQUIRED`, `SKU_INVALID` |
| description | optional, ≤ 5000 characters | `DESCRIPTION_TOO_LONG` |
| category | required ⚠️, ≤ 60 characters | `CATEGORY_REQUIRED` |
| price | `parseMoney` (§4.4); `$` prefix allowed ⚠️ | `PRICE_REQUIRED`, `INVALID_PRICE` |
| stock | trim; must match `^\d+$` (non-negative integer); ≤ 1,000,000 | `STOCK_REQUIRED`, `INVALID_STOCK`, `NEGATIVE_STOCK` |
| weight_kg | optional ⚠️; if present, decimal with ≤ 3 places, ≥ 0 | `INVALID_WEIGHT` |

- All failing fields of a row are reported (one issue per field), and the row is rejected.
- Duplicate SKU within the file: the later valid row replaces the earlier one. A WARNING `DUPLICATE_SKU_IN_FILE` is recorded on the later line, naming the line it replaced.
- The deduped row keeps the line number of its last occurrence.

#### 6.7.4 Persistence per batch (500 rows, one transaction)

1. Resolve category names: insert missing ones with `INSERT ... ON CONFLICT (name) DO NOTHING`, then select the ids.
2. `SELECT id, sku, name, description, category_id, price_cents, stock, reserved, weight_grams, deleted_at FROM products WHERE sku = ANY($skus) FOR UPDATE`.
3. Classify each row:
   - **create**: SKU not found
   - **restore**: found and soft-deleted. Counted as updated; `deleted_at` is cleared ⚠️.
   - **unchanged**: every field equal
   - **conflict**: new stock is below `reserved`. The row gets ERROR `STOCK_BELOW_RESERVED` and is not written.
   - **update**: anything else
4. One multi-row `INSERT` for creates. One `UPDATE ... FROM (VALUES ...)` for updates and restores, with `version = version + 1`.
5. Counters are accumulated in memory. Issues are bulk-inserted per batch.

If a batch fails unexpectedly, the job becomes `FAILED` with `failure_message`. Earlier batches stay committed, and re-running is safe because of the upsert semantics.

#### 6.7.5 Expected result for the example file (test oracle)

| Counter | Fresh database | Re-import |
|---|---|---|
| total_lines (excluding header) | 97 | 97 |
| blank_lines | 2 | 2 |
| processed_rows | 95 | 95 |
| rejected_count | 5 | 5 |
| warning_count | 3 | 3 |
| created_count | 87 | 0 |
| updated_count | 0 | 0 |
| unchanged_count | 0 | 87 |
| status | COMPLETED_WITH_ERRORS | COMPLETED_WITH_ERRORS |

Rejected lines: 7 YM-015 (`INVALID_PRICE`), 16 DL-007 (`NEGATIVE_STOCK`), 25 HD-099 (`NAME_REQUIRED`), 41 WS-001 (`NAME_REQUIRED`), 52 GC-025 (`CATEGORY_REQUIRED`).
Warnings: line 36 RS-001, line 56 BS-021, line 89 BS-021.
The final BS-021 holds the data from line 89 (price 59.99, stock 110). The final RS-001 holds line 36 (price 94.99, stock 120).

#### 6.7.6 Error report download
- `GET /v1/imports/:id/issues?format=csv` returns `line,sku,field,value,code,message,severity`.
- Every cell that starts with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` (formula-injection protection).
- `Content-Disposition: attachment; filename="import-<id>-issues.csv"`.

### 6.8 Inventory: reservations

Reserve (consumer of `orders.order.created.v1`), in one transaction:

```sql
SELECT id FROM products WHERE id = ANY($productIds) ORDER BY id FOR UPDATE;

UPDATE products
SET reserved = reserved + $qty, version = version + 1, updated_at = now()
WHERE id = $productId AND deleted_at IS NULL AND stock - reserved >= $qty;
```

- Lines are processed in ascending product id order to avoid deadlocks.
- If any line affects 0 rows, the whole transaction rolls back. Then, in a new transaction, the service writes `processed_messages` and the outbox event `catalog.stock.reservation-failed.v1`, listing each unavailable line with its requested and available quantity.
- On success it inserts `stock_reservations` rows (`RESERVED`, `expires_at = now() + RESERVATION_TTL`) and the outbox event `catalog.stock.reserved.v1`.

Commit (consumer of `orders.order.confirmed.v1`):
- Reservations in `RESERVED`: `stock = stock − qty`, `reserved = reserved − qty`, status `COMMITTED`.
- Reservations already `EXPIRED`: try a direct conditional decrement (`stock − reserved ≥ qty`).
  - On success: mark `COMMITTED`.
  - On failure: emit `catalog.stock.commit-failed.v1`, and orders cancels and refunds.
- Reservations already `COMMITTED`: no-op (idempotent).

Release (consumer of `orders.order.cancelled.v1`): reservations in `RESERVED` get `reserved −= qty` and status `RELEASED`. Any other state is a no-op.

Expiry sweeper:
- Runs every `RESERVATION_SWEEP_INTERVAL_MS` (default 30 s) with a Postgres advisory lock, so only one instance sweeps.
- Selects up to 200 reservations with `status = 'RESERVED' AND expires_at < now()`, using `FOR UPDATE SKIP LOCKED`.
- Releases them (status `EXPIRED`) and emits one `catalog.stock.reservation-expired.v1` per order.

### 6.9 Internal snapshot API

`GET /internal/v1/products/snapshot?ids=<uuid>,<uuid>` (at most 50 ids), reachable only on the compose network:

```json
{ "data": [ { "id": "0190…", "sku": "RS-001", "name": "Running Shoes", "priceCents": 9499,
              "currency": "USD", "available": 120, "active": true } ] }
```

Unknown ids are omitted from the result. orders treats an omitted id as `PRODUCT_UNAVAILABLE`.

### 6.10 Seeding (UC-15)

- On boot, after migrations, `SeedingService` checks `SELECT count(*) FROM import_jobs WHERE source = 'SEED'`.
- If the count is 0 and the products table is empty, it runs the import use case on `seed/example.csv` with `source = 'SEED'`. The image includes the file copied from the repository root.
- An advisory lock prevents concurrent seeding. Disabled with `SEED_ON_START=false`.

---

## 7. Service: orders

### 7.1 Domain model and state machine

```mermaid
stateDiagram-v2
  [*] --> PENDING: PlaceOrder
  PENDING --> AWAITING_PAYMENT: StockReserved (total > 0)
  PENDING --> CONFIRMED: StockReserved (total = 0) ⚠️
  PENDING --> CANCELLED: ReservationFailed
  AWAITING_PAYMENT --> CONFIRMED: PaymentSucceeded
  AWAITING_PAYMENT --> CANCELLED: PaymentFailed
  AWAITING_PAYMENT --> CANCELLED: ReservationExpired
  CONFIRMED --> CANCELLED: StockCommitFailed (refund)
  CONFIRMED --> [*]
  CANCELLED --> [*]
```

| Event received | PENDING | AWAITING_PAYMENT | CONFIRMED | CANCELLED |
|---|---|---|---|---|
| StockReserved | → AWAITING_PAYMENT, or CONFIRMED if the total is 0 | ignore (duplicate) | ignore | emit release (`order.cancelled` again) |
| ReservationFailed | → CANCELLED `OUT_OF_STOCK` | ignore | ignore | ignore |
| PaymentSucceeded | not possible; log WARN | → CONFIRMED | ignore | emit `payments.refund.requested.v1` (late payment) |
| PaymentFailed | log WARN | → CANCELLED `PAYMENT_DECLINED` | ignore | ignore |
| ReservationExpired | → CANCELLED `RESERVATION_EXPIRED` | → CANCELLED `RESERVATION_EXPIRED` | ignore | ignore |
| StockCommitFailed | — | — | → CANCELLED `STOCK_COMMIT_FAILED` + refund | ignore |

Every transition:
- inserts a row into `order_status_history`
- increments `version`
- writes the outbox events in the same transaction.

Cancellation reasons: `OUT_OF_STOCK`, `PAYMENT_DECLINED`, `RESERVATION_EXPIRED`, `STOCK_COMMIT_FAILED`.

### 7.2 Database schema (`orders_db`)

```sql
CREATE TYPE order_status AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'CONFIRMED', 'CANCELLED');

CREATE TABLE orders (
  id                 uuid PRIMARY KEY,
  status             order_status NOT NULL,
  customer_name      text NOT NULL,
  customer_email     text NOT NULL,
  currency           char(3) NOT NULL DEFAULT 'USD',
  total_cents        bigint NOT NULL CHECK (total_cents >= 0),
  payment_method_id  text NOT NULL,
  payment_status     text NULL,
  payment_last4      char(4) NULL,
  payment_decline_reason text NULL,
  cancel_reason      text NULL,
  cancel_detail      jsonb NULL,
  idempotency_key    uuid NOT NULL UNIQUE,
  request_hash       char(64) NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE order_lines (
  id                uuid PRIMARY KEY,
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL,
  sku               text NOT NULL,
  name              text NOT NULL,
  unit_price_cents  bigint NOT NULL CHECK (unit_price_cents >= 0),
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_cents  bigint NOT NULL CHECK (line_total_cents >= 0),
  UNIQUE (order_id, product_id)
);

CREATE TABLE order_status_history (
  id           uuid PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status  order_status NULL,
  to_status    order_status NOT NULL,
  reason       text NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, occurred_at);
```

It also has `outbox` and `processed_messages` tables, identical to catalog's.

### 7.3 PlaceOrder use case

Input (validated with `PlaceOrderRequest`):

```json
{
  "customer": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "lines": [ { "productId": "0190…", "quantity": 2 } ],
  "paymentMethodId": "pm_8Kq…",
  "expectedTotalCents": 18998
}
```

Rules:
- 1–50 lines, quantity 1–99, no duplicate `productId`.
- The `Idempotency-Key` header is required and must be a UUID.

Steps:
1. `request_hash = sha256(canonicalJson(body))`.
2. Look up the order by `idempotency_key`:
   - Found with the same hash: return the stored order (202, header `Idempotent-Replayed: true`).
   - Found with a different hash: 422 `IDEMPOTENCY_KEY_REUSED`.
3. Call the catalog snapshot (timeout 2 s, 2 retries with jitter, circuit breaker that opens after 5 consecutive failures for 30 s). On failure: 503 `CATALOG_UNAVAILABLE`.
4. Any line that is missing or inactive: 409 `PRODUCT_UNAVAILABLE`, with `unavailable: [productId]`.
5. Any line with `available < quantity`: 409 `INSUFFICIENT_STOCK` (a fast pre-check; the reservation remains the source of truth).
6. Compute `line_total = unit_price × qty` and `total = Σ line_total`, as integers.
7. If `expectedTotalCents` is present and differs from the total: 409 `PRICE_CHANGED`, with the current lines and total ⚠️.
8. In one transaction, insert the order (`PENDING`), its lines, the history row and the outbox `orders.order.created.v1`. A unique violation on `idempotency_key` (concurrent duplicate) re-reads and replays.
9. Respond 202 with the order representation and `Location: /v1/orders/:id`.

`paymentMethodId` is not checked against payments synchronously. An unknown or expired method causes `PaymentFailed(INVALID_PAYMENT_METHOD)` later in the saga.

### 7.4 Saga orchestration

Implemented in `OrderSagaHandler` (consumer of queue `orders.saga`). It applies the state machine in §7.1 inside one transaction per message, together with the `processed_messages` insert.

Commands and events emitted by orders:

| Trigger | Emits |
|---|---|
| PlaceOrder | `orders.order.created.v1` |
| StockReserved, total > 0 | `payments.charge.requested.v1` |
| StockReserved, total = 0 | `orders.order.confirmed.v1` |
| PaymentSucceeded | `orders.order.confirmed.v1` |
| PaymentFailed / ReservationExpired | `orders.order.cancelled.v1` |
| PaymentSucceeded on a cancelled order | `payments.refund.requested.v1` |
| StockCommitFailed | `orders.order.cancelled.v1` and `payments.refund.requested.v1` |

### 7.5 Queries

- `GET /v1/orders/:id` returns the full order with lines, payment summary, cancel reason and status history.
- `GET /v1/orders?status=&page=&pageSize=` returns a summary list (admin), newest first.

---

## 8. Service: payments

### 8.1 Payment methods (tokenization)

- `POST /v1/payments/methods` takes `{ "cardNumber": "4242 4242 4242 4242", "expMonth": 12, "expYear": 2030, "cvc": "123", "holderName": "Ada Lovelace" }`.
- Validation:
  - Spaces and dashes are stripped from the card number, which must be 13–19 digits and pass the Luhn check.
  - The expiry must be the current month or later.
  - The CVC must be 3–4 digits.
- Brand detection: a leading `4` is `visa`; `51`–`55` and `2221`–`2720` are `mastercard`; `34` and `37` are `amex`; anything else is `unknown`.
- The simulated outcome is fixed at tokenization:

| Card number | Outcome |
|---|---|
| 4242 4242 4242 4242 | APPROVE |
| 4000 0000 0000 0002 | DECLINE `CARD_DECLINED` |
| 4000 0000 0000 9995 | DECLINE `INSUFFICIENT_FUNDS` |
| 4000 0000 0000 0119 | FAIL_ONCE `PROCESSING_ERROR`: the first attempt errors transiently, the retry approves |
| Any other valid card | APPROVE |

- Additional rule at charge time: an amount above 1,000,000 cents (10,000.00) is declined with `LIMIT_EXCEEDED`.
- Response 201: `{ "id": "pm_…", "brand": "visa", "last4": "4242", "expMonth": 12, "expYear": 2030, "expiresAt": "…" }`. Tokens expire after `PAYMENT_METHOD_TTL` (default 30 min).
- The full card number and CVC are never stored or logged. Logger redaction covers the `cardNumber` and `cvc` paths.

### 8.2 Database schema (`payments_db`)

```sql
CREATE TYPE payment_outcome AS ENUM ('APPROVE', 'DECLINE', 'FAIL_ONCE');
CREATE TYPE payment_status  AS ENUM ('SUCCEEDED', 'FAILED', 'REFUNDED');

CREATE TABLE payment_methods (
  id                 text PRIMARY KEY,
  brand              text NOT NULL,
  last4              char(4) NOT NULL,
  exp_month          smallint NOT NULL,
  exp_year           smallint NOT NULL,
  holder_name        text NOT NULL,
  simulated_outcome  payment_outcome NOT NULL,
  decline_reason     text NULL,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id                 uuid PRIMARY KEY,
  order_id           uuid NOT NULL UNIQUE,
  payment_method_id  text NOT NULL REFERENCES payment_methods(id),
  amount_cents       bigint NOT NULL CHECK (amount_cents >= 0),
  currency           char(3) NOT NULL,
  status             payment_status NOT NULL,
  decline_reason     text NULL,
  attempts           integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

It also has `outbox` and `processed_messages` tables.

### 8.3 Charge handling (`payments.charge.requested.v1`)

1. If `payments.order_id` already exists, re-emit the stored result (idempotent).
2. Load the payment method. If it is missing or expired: FAILED `INVALID_PAYMENT_METHOD`.
3. If the amount is above the limit: FAILED `LIMIT_EXCEEDED`.
4. Apply `simulated_outcome`. `FAIL_ONCE` throws a transient error on the first delivery, so the message is retried through the retry queue (§9.3) and succeeds on the next attempt.
5. Optional latency of `PAYMENT_SIMULATED_LATENCY_MS` (default 800 ms) makes the async states visible in the UI.
6. Insert the payment and the outbox `payments.payment.succeeded.v1` or `payments.payment.failed.v1`, with `last4` and `declineReason`.

Refund (`payments.refund.requested.v1`): status becomes `REFUNDED`, and `payments.payment.refunded.v1` is emitted (informational).

---

## 9. Messaging and the checkout saga

### 9.1 Event envelope (`@stockroom/contracts/events`)

```ts
type EventEnvelope<TType extends string, TPayload> = {
  id: string;
  type: TType;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  producer: 'catalog' | 'orders' | 'payments';
  payload: TPayload;
};
```

AMQP message properties: `messageId = id`, `type = type`, `correlationId`, `contentType = application/json`, `deliveryMode = 2` (persistent), `timestamp`.

### 9.2 Event catalog

| Type | Producer | Consumers | Payload |
|---|---|---|---|
| `orders.order.created.v1` | orders | catalog | `{ orderId, lines: [{ productId, sku, quantity }] }` |
| `orders.order.confirmed.v1` | orders | catalog | `{ orderId }` |
| `orders.order.cancelled.v1` | orders | catalog | `{ orderId, reason }` |
| `catalog.stock.reserved.v1` | catalog | orders | `{ orderId, expiresAt }` |
| `catalog.stock.reservation-failed.v1` | catalog | orders | `{ orderId, lines: [{ productId, sku, requested, available }] }` |
| `catalog.stock.reservation-expired.v1` | catalog | orders | `{ orderId }` |
| `catalog.stock.commit-failed.v1` | catalog | orders | `{ orderId, lines: [{ productId, sku, requested, available }] }` |
| `payments.charge.requested.v1` | orders | payments | `{ orderId, amountCents, currency, paymentMethodId }` |
| `payments.refund.requested.v1` | orders | payments | `{ orderId, reason }` |
| `payments.payment.succeeded.v1` | payments | orders | `{ orderId, paymentId, amountCents, last4 }` |
| `payments.payment.failed.v1` | payments | orders | `{ orderId, reason, last4 \| null }` |
| `payments.payment.refunded.v1` | payments | — | `{ orderId, paymentId }` |

Versioning: an additive optional field keeps the same version. Any breaking change creates `.v2`, published in parallel until all consumers have migrated.

### 9.3 Topology

| Element | Name | Settings |
|---|---|---|
| Exchange | `stockroom.events` | topic, durable |
| Exchange | `stockroom.retry` | direct, durable |
| Exchange | `stockroom.dlx` | direct, durable |
| Queue | `catalog.inventory` | bindings `orders.order.*.v1`; DLX `stockroom.dlx` |
| Queue | `orders.saga` | bindings `catalog.stock.*.v1`, `payments.payment.*.v1` |
| Queue | `payments.commands` | bindings `payments.charge.requested.v1`, `payments.refund.requested.v1` |
| Retry queues | `<queue>.retry.1s`, `.retry.5s`, `.retry.30s` | `x-message-ttl` of 1 s / 5 s / 30 s, dead-letter back to the original queue |
| DLQ | `<queue>.dlq` | for inspection; no consumer |

Consumer behavior:
- Prefetch 10. Manual ack.
- Schema-invalid message: straight to the DLQ.
- Transient error: republish to the next retry tier, with an `x-attempt` header.
- After 3 attempts: DLQ.
- Handled successfully: ack.

### 9.4 Outbox relay (`@stockroom/platform`)

- Polls every 250 ms, plus an immediate wake-up after commits through an in-process notifier.
- Each cycle, in one transaction:
  1. `SELECT ... FROM outbox WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED`
  2. Publish each row with publisher confirms.
  3. Set `published_at`. On failure, increment `attempts` and set `last_error`.
- A cleanup job deletes published rows older than 7 days.
- Delivery is at-least-once. Duplicates are absorbed by `processed_messages`.

### 9.5 Idempotent consumer (`@stockroom/platform`)

```
handle(message):
  validate envelope + payload with zod → invalid: DLQ
  BEGIN
    INSERT INTO processed_messages(message_id, consumer) ON CONFLICT DO NOTHING
    if 0 rows → COMMIT; ack; return
    run handler(tx, event)
  COMMIT
  ack
```

### 9.6 Happy-path sequence

```mermaid
sequenceDiagram
  autonumber
  participant W as Web
  participant G as Gateway
  participant P as Payments
  participant O as Orders
  participant C as Catalog
  participant MQ as RabbitMQ
  W->>G: POST /payments/methods (card)
  G->>P: forward
  P-->>W: 201 { id: pm_…, last4 }
  W->>G: POST /orders (Idempotency-Key, lines, pm_…)
  G->>O: forward
  O->>C: GET /internal/v1/products/snapshot
  C-->>O: prices, availability
  O->>O: tx: order PENDING + outbox OrderCreated
  O-->>W: 202 { id, status: PENDING }
  O-)MQ: orders.order.created.v1
  MQ-)C: OrderCreated
  C->>C: tx: reserve stock + outbox StockReserved
  C-)MQ: catalog.stock.reserved.v1
  MQ-)O: StockReserved
  O->>O: tx: AWAITING_PAYMENT + outbox ChargeRequested
  O-)MQ: payments.charge.requested.v1
  MQ-)P: ChargeRequested
  P->>P: tx: payment SUCCEEDED + outbox PaymentSucceeded
  P-)MQ: payments.payment.succeeded.v1
  MQ-)O: PaymentSucceeded
  O->>O: tx: CONFIRMED + outbox OrderConfirmed
  O-)MQ: orders.order.confirmed.v1
  MQ-)C: OrderConfirmed
  C->>C: tx: commit reservation (stock -= qty)
  loop every 1 s (backoff to 3 s)
    W->>G: GET /orders/:id
    G->>O: forward
    O-->>W: status
  end
```

### 9.7 Failure scenarios

| Scenario | Outcome |
|---|---|
| Insufficient stock at reservation | `reservation-failed` → CANCELLED `OUT_OF_STOCK`; nothing reserved |
| Card declined | `payment.failed` → CANCELLED `PAYMENT_DECLINED` → `order.cancelled` → reservation RELEASED |
| Payments down | Charge message stays queued. If the reservation expires first, the order is CANCELLED `RESERVATION_EXPIRED`; a later success triggers a refund |
| RabbitMQ down | The outbox accumulates and the API keeps accepting orders (PENDING). The relay publishes on recovery |
| Duplicate message | `processed_messages` absorbs it |
| Crash between DB commit and publish | The outbox row is still unpublished; the relay publishes it after restart |
| Two orders for the last unit | Conditional UPDATE lets one through; the other gets `reservation-failed` |
| Same Idempotency-Key submitted twice | One order; the second call replays it |

---

## 10. Public REST API reference

Base URL is `http://localhost:8080/api/v1` through nginx; the gateway also listens on 3000 internally. All errors follow §11.

### 10.1 Products

#### `GET /products/:id`
200, with header `ETag: "<version>"`:

```json
{
  "id": "0190a3c2-7d1e-7b2a-9c4f-1f2e3d4c5b6a",
  "sku": "RS-001",
  "name": "Running Shoes",
  "description": "Updated lightweight shoes — now with better arch support",
  "category": { "id": "0190…", "name": "Footwear", "slug": "footwear" },
  "price": { "amountCents": 9499, "currency": "USD" },
  "stock": 120,
  "reserved": 0,
  "available": 120,
  "weightGrams": 350,
  "version": 2,
  "createdAt": "2026-10-05T16:00:00.000Z",
  "updatedAt": "2026-10-05T16:00:00.000Z"
}
```

Errors: 404 `PRODUCT_NOT_FOUND`.

#### `POST /products`

```json
{ "sku": "nb-200", "name": "Dotted Notebook", "description": "A5, 160 pages",
  "category": "Stationery", "priceCents": 650, "stock": 300, "weightGrams": 280 }
```

201 with the product, `Location` and `ETag`. Errors: 400 `VALIDATION`, 409 `DUPLICATE_SKU`.

#### `PUT /products/:id`
Requires the header `If-Match: "<version>"`. The body is the same as POST without `sku`. The SKU is immutable ⚠️; including it gives 400.
200 with the updated product. Errors: 400, 404, 409 `VERSION_CONFLICT` (body contains `currentVersion`), 409 `STOCK_BELOW_RESERVED`, 428 `PRECONDITION_REQUIRED` when `If-Match` is missing.

#### `DELETE /products/:id`
204. Errors: 404, 409 `PRODUCT_HAS_ACTIVE_RESERVATIONS`.

### 10.2 Product listing and search

#### `GET /products`

| Param | Type | Default | Rules |
|---|---|---|---|
| `q` | string | `''` | ≤ 100 characters |
| `category` | string (repeatable) | — | category slug |
| `minPriceCents` | int | — | ≥ 0 |
| `maxPriceCents` | int | — | ≥ `minPriceCents` |
| `inStock` | boolean | `false` | `true` hides items with available = 0 |
| `sort` | enum | `relevance` if `q`, else `newest` | `relevance`, `price_asc`, `price_desc`, `name_asc`, `newest` |
| `page` | int | 1 | ≥ 1 |
| `pageSize` | int | 20 | 1–100 |

200 with the paginated envelope of product summaries (same fields as the detail, `description` truncated to 200 characters). Errors: 400 `VALIDATION`.

#### `GET /categories`
200: `{ "data": [ { "id": "…", "name": "Electronics", "slug": "electronics", "productCount": 19 } ] }`.

### 10.3 Imports

| Endpoint | Response |
|---|---|
| `POST /imports` (multipart `file`) | 201 `ImportJob`; 400 `VALIDATION` / `UNSUPPORTED_FILE`; 413 `FILE_TOO_LARGE`; 422 `CSV_INVALID_HEADER` |
| `GET /imports?page=&pageSize=` | 200, paginated `ImportJob` list, newest first |
| `GET /imports/:id` | 200 `ImportJob`; 404 `IMPORT_NOT_FOUND` |
| `GET /imports/:id/issues?severity=&page=&pageSize=` | 200, paginated issues sorted by line |
| `GET /imports/:id/issues?format=csv` | 200 `text/csv` attachment |

`ImportJob`:

```json
{
  "id": "0190…",
  "filename": "Code Challenge E-Commerce.csv",
  "source": "UPLOAD",
  "status": "COMPLETED_WITH_ERRORS",
  "totals": { "totalLines": 97, "blankLines": 2, "processedRows": 95, "created": 87,
              "updated": 0, "unchanged": 0, "rejected": 5, "warnings": 3 },
  "failureMessage": null,
  "startedAt": "2026-10-05T16:00:00.000Z",
  "finishedAt": "2026-10-05T16:00:00.412Z"
}
```

Issue:

```json
{ "line": 7, "sku": "YM-015", "field": "price", "value": "free",
  "code": "INVALID_PRICE", "message": "Price must be a decimal number with up to 2 decimals", "severity": "ERROR" }
```

### 10.4 Payment methods

`POST /payments/methods`: see §8.1. Errors: 400 `VALIDATION` (field errors on `cardNumber`, `expMonth`/`expYear`, `cvc`).

### 10.5 Orders

#### `POST /orders`
Requires the header `Idempotency-Key: <uuid>`. Body per §7.3.
202 with the `Order` representation, `Location`, and `Idempotent-Replayed: true` when the request is a replay.
Errors:
- 400 `VALIDATION`
- 409 `PRODUCT_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `PRICE_CHANGED`
- 422 `IDEMPOTENCY_KEY_REUSED`
- 428 `IDEMPOTENCY_KEY_REQUIRED`
- 503 `CATALOG_UNAVAILABLE`

#### `GET /orders/:id`

```json
{
  "id": "0190…",
  "status": "CANCELLED",
  "customer": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "lines": [ { "productId": "0190…", "sku": "VC-001", "name": "Vintage Clock",
               "unitPrice": { "amountCents": 29999, "currency": "USD" }, "quantity": 1,
               "lineTotal": { "amountCents": 29999, "currency": "USD" } } ],
  "total": { "amountCents": 29999, "currency": "USD" },
  "payment": null,
  "cancellation": { "reason": "OUT_OF_STOCK",
                    "detail": { "lines": [ { "sku": "VC-001", "requested": 1, "available": 0 } ] } },
  "history": [ { "from": null, "to": "PENDING", "reason": null, "at": "…" },
               { "from": "PENDING", "to": "CANCELLED", "reason": "OUT_OF_STOCK", "at": "…" } ],
  "createdAt": "…",
  "updatedAt": "…"
}
```

When present, `payment` is `{ "status": "SUCCEEDED" | "FAILED" | "REFUNDED", "last4": "4242", "declineReason": null }`.
Errors: 404 `ORDER_NOT_FOUND`.

#### `GET /orders?status=&page=&pageSize=`
200, paginated order summaries: `id`, `status`, `total`, `customer.email`, `lineCount`, `createdAt`.

### 10.6 OpenAPI

- Each service serves `/docs` and `/docs-json`, generated from its zod schemas.
- The gateway merges the public operations under `/api/docs`. Internal operations are excluded.

---

## 11. Error catalog

Problem body: `type = https://stockroom.local/problems/<kebab-code>`, `title`, `status`, `detail`, `instance`, `code`, `correlationId`, plus optional `errors[]` and extension members.

| Code | HTTP | Raised by | Extension members |
|---|---|---|---|
| `VALIDATION` | 400 | all | `errors: [{ path, message }]` |
| `UNSUPPORTED_FILE` | 400 | catalog | — |
| `PRODUCT_NOT_FOUND` | 404 | catalog | — |
| `IMPORT_NOT_FOUND` | 404 | catalog | — |
| `ORDER_NOT_FOUND` | 404 | orders | — |
| `DUPLICATE_SKU` | 409 | catalog | `sku` |
| `VERSION_CONFLICT` | 409 | catalog | `currentVersion` |
| `STOCK_BELOW_RESERVED` | 409 | catalog | `reserved` |
| `PRODUCT_HAS_ACTIVE_RESERVATIONS` | 409 | catalog | `reserved` |
| `PRODUCT_UNAVAILABLE` | 409 | orders | `productIds` |
| `INSUFFICIENT_STOCK` | 409 | orders | `lines: [{ productId, sku, requested, available }]` |
| `PRICE_CHANGED` | 409 | orders | `lines`, `totalCents` |
| `FILE_TOO_LARGE` | 413 | gateway/catalog | `maxBytes` |
| `CSV_INVALID_HEADER` | 422 | catalog | `missing`, `jobId` |
| `IDEMPOTENCY_KEY_REUSED` | 422 | orders | — |
| `PRECONDITION_REQUIRED` | 428 | catalog | — |
| `IDEMPOTENCY_KEY_REQUIRED` | 428 | orders | — |
| `RATE_LIMITED` | 429 | gateway | `Retry-After` header |
| `INTERNAL` | 500 | all | no stack trace or internals |
| `UPSTREAM_UNAVAILABLE` | 502 | gateway | `service` |
| `CATALOG_UNAVAILABLE` | 503 | orders | — |
| `UPSTREAM_TIMEOUT` | 504 | gateway | `service` |

Domain error classes are mapped in one registry per service. Postgres errors are translated as follows:
- `P2002` (unique violation) → the domain conflict
- `P2025` (record not found) → not found
- anything else → `INTERNAL`, logged with its stack trace.

---

## 12. Frontend (apps/web)

### 12.1 Stack

React 19, Vite, TypeScript strict, React Router (data routers), TanStack Query v5, react-hook-form with zodResolver, Tailwind CSS, shadcn/ui (Radix), lucide-react icons, sonner toasts, Vitest + Testing Library + MSW, Playwright, axe-core.

### 12.2 Routes

| Path | Screen | Use case |
|---|---|---|
| `/` | redirects to `/shop` | — |
| `/shop` | Catalog with search bar, filters, sort, pagination | UC-01, UC-02 |
| `/shop/products/:id` | Product detail with quantity and "Add to cart" | UC-03, UC-09 |
| `/shop/cart` | Cart | UC-09 |
| `/shop/checkout` | Customer and card form, test-card hints, Place order | UC-10 |
| `/shop/orders/:id` | Order status (polling) | UC-12 |
| `/admin/products` | Product table with search and filters | UC-01, UC-02 |
| `/admin/products/new` | Create form | UC-04 |
| `/admin/products/:id/edit` | Edit form with version handling | UC-05 |
| `/admin/imports` | Upload area and import history | UC-07 |
| `/admin/imports/:id` | Import result and issues table, with CSV download | UC-08 |
| `/admin/orders` | Orders list with status filter | UC-13 |
| `/admin/orders/:id` | Order detail with history | UC-13 |

The layout has a top bar with a Shop/Admin switch, a cart badge in Shop, and a banner reading "Demo — no authentication" ⚠️.

### 12.3 Source layout

```
src/
  app/        router.tsx, providers.tsx, layouts/{ShopLayout,AdminLayout}.tsx, RouteError.tsx
  features/
    products/ api.ts, keys.ts, ProductTable.tsx, ProductForm.tsx, DeleteProductDialog.tsx, ProductDetail.tsx
    search/   SearchBar.tsx, FiltersPanel.tsx, useSearchParamsState.ts
    imports/  api.ts, UploadDropzone.tsx, ImportSummary.tsx, IssuesTable.tsx, ImportHistory.tsx
    cart/     cartStore.ts, CartPage.tsx, AddToCart.tsx
    checkout/ api.ts, CheckoutForm.tsx, TestCardsHint.tsx
    orders/   api.ts, OrderStatusPage.tsx, OrdersTable.tsx, OrderDetail.tsx
  shared/
    api/      http.ts (fetch wrapper), problem.ts (ProblemError), queryClient.ts
    ui/       shadcn components
    lib/      money.ts, debounce.ts, uuid.ts
```

### 12.4 Data layer

- `http.ts` handles every request:
  - Base path `/api/v1`. Sets `x-request-id` per request, with `crypto.randomUUID()`.
  - Parses `application/problem+json` into a `ProblemError` that exposes `code`, `status`, `errors[]` and the extension members.
  - Parses responses with the contracts zod schemas at runtime, so contract drift fails loudly in development.
- Query keys:
  - `['products', 'list', params]`
  - `['products', 'detail', id]`
  - `['categories']`
  - `['imports', 'list', page]`
  - `['imports', 'detail', id]`
  - `['imports', 'issues', id, params]`
  - `['orders', 'list', params]`
  - `['orders', 'detail', id]`
- Defaults: `staleTime` 30 s for lists and 0 for order detail; `retry` 1 for queries and 0 for mutations; `refetchOnWindowFocus` true.
- Mutation invalidation:

| Mutation | Invalidates |
|---|---|
| create product | products list, categories |
| update product | product detail (set from the response), products list |
| delete product | products list, categories; detail query removed |
| import | products, categories, imports |
| place order | none; navigates to the status page |

### 12.5 Behavior details

- **Search state**:
  - All filters live in the URL (`?q=&category=&minPrice=&maxPrice=&inStock=&sort=&page=`).
  - Price inputs are in dollars in the UI and converted with `parseMoney`.
  - Input is debounced by 300 ms.
  - Changing a filter resets to page 1.
  - `placeholderData: keepPreviousData` keeps the previous results visible while fetching.
- **Product form**: a shared zod schema with the price as a string input converted to cents. On `DUPLICATE_SKU`, an error is set on `sku`. On `VERSION_CONFLICT`, a dialog offers "Reload latest" (refetch and re-apply the user's dirty fields) or "Cancel". On `STOCK_BELOW_RESERVED`, an error is set on `stock` showing the reserved count.
- **Import**:
  - Drag-and-drop or file picker. The client rejects files that are not `.csv` or exceed 5 MB.
  - Upload uses XHR so `onprogress` can drive a progress bar.
  - The result view shows counters as stat cards, then the issues table filterable by severity, then the CSV download button.
- **Cart** (`cartStore.ts`):
  - A tiny store using `useSyncExternalStore`, persisted to `localStorage` under the key `stockroom.cart.v1`.
  - Validated with zod on load and reset if invalid.
  - Lines are `{ productId, sku, name, unitPriceCents, quantity }`, quantity 1–99 and capped at the last known `available`.
  - On the cart page, the current product data is refetched. Price or availability changes are flagged per line.
- **Checkout**:
  1. Generate the `Idempotency-Key` once per checkout attempt, in component state. Regenerate only after the cart changes.
  2. Call `POST /payments/methods`, then `POST /orders` with `expectedTotalCents`.
  3. On `PRICE_CHANGED`, show the new total and require reconfirmation.
  4. The submit button is disabled while pending.
  5. A test-card hint panel lists the cards from §8.1.
- **Order status**:
  - Polls with `refetchInterval` at 1 s, backing off to 3 s after 10 s, and stops at CONFIRMED or CANCELLED or after 60 s ("Still processing" plus a manual refresh).
  - On CONFIRMED the cart is cleared.
  - On CANCELLED the reason is shown in human terms:
    - `OUT_OF_STOCK`: the affected SKUs
    - `PAYMENT_DECLINED`: the decline reason
    - `RESERVATION_EXPIRED`: "took too long"
- **Rendering safety**: product text is rendered only as React text nodes. `dangerouslySetInnerHTML` is never used, and an ESLint rule forbids it.

### 12.6 UX and accessibility

- Every query view has a skeleton loading state, an error state with Retry, and an empty state.
- Every route has an error boundary.
- Dialogs trap focus and return focus to their trigger. Every input has a label. Field errors are linked with `aria-describedby`. Toasts are announced politely.
- Color contrast meets WCAG AA. The UI is fully keyboard operable and responsive down to 360 px.

### 12.7 Build and serve

- `vite build` outputs to `dist/`. nginx serves it with `try_files $uri /index.html`. `location /api/` proxies to `http://gateway:3000/api/`.
- Security headers in nginx: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- `client_max_body_size 6m`.

---

## 13. Runtime, configuration and deployment

### 13.1 Docker Compose

| Service | Image / build | Host port | Depends on (healthy) | Healthcheck |
|---|---|---|---|---|
| postgres | `postgres:17-alpine` | `${POSTGRES_PORT:-5432}` | — | `pg_isready -U postgres` |
| rabbitmq | `rabbitmq:4-management-alpine` | `15672` (UI) | — | `rabbitmq-diagnostics -q ping` |
| catalog | `services/catalog/Dockerfile` | — | postgres, rabbitmq | `wget -qO- localhost:3001/health/ready` |
| orders | `services/orders/Dockerfile` | — | postgres, rabbitmq, catalog | `…:3002/health/ready` |
| payments | `services/payments/Dockerfile` | — | postgres, rabbitmq | `…:3003/health/ready` |
| gateway | `services/gateway/Dockerfile` | — | catalog, orders, payments | `…:3000/health/ready` |
| web | `apps/web/Dockerfile` | `${WEB_PORT:-8080}` | gateway | `wget -qO- localhost/` |

- Volumes: `pgdata`, `rabbitdata`.
- Network: the default compose network.
- Every service has `restart: unless-stopped`.
- `docker compose down -v` resets all data.

### 13.2 Postgres initialization (`infra/postgres/init.sql`)

- Creates the roles `catalog`, `orders` and `payments` with passwords from environment variables. Each role owns its own database.
- `REVOKE CONNECT ... FROM PUBLIC` on each database, so a role can only reach its own.

### 13.3 Environment variables

| Variable | Service | Default | Description |
|---|---|---|---|
| `NODE_ENV` | all | `production` | |
| `PORT` | all | 3000 / 3001 / 3002 / 3003 | HTTP port |
| `LOG_LEVEL` | all | `info` | pino level |
| `DATABASE_URL` | catalog, orders, payments | `postgresql://<svc>:<svc>@postgres:5432/<svc>_db` | pg connection string |
| `AMQP_URL` | catalog, orders, payments | `amqp://stockroom:stockroom@rabbitmq:5672` | broker |
| `CATALOG_URL` | gateway, orders | `http://catalog:3001` | upstream |
| `ORDERS_URL` | gateway | `http://orders:3002` | upstream |
| `PAYMENTS_URL` | gateway | `http://payments:3003` | upstream |
| `WEB_ORIGIN` | gateway | `http://localhost:5173` | CORS for dev |
| `RESERVATION_TTL_SECONDS` | catalog | `600` | reservation lifetime |
| `RESERVATION_SWEEP_INTERVAL_MS` | catalog | `30000` | sweeper period |
| `IMPORT_MAX_BYTES` | catalog | `5242880` | upload limit |
| `IMPORT_MAX_ROWS` | catalog | `50000` | row limit |
| `IMPORT_BATCH_SIZE` | catalog | `500` | upsert batch |
| `SEED_ON_START` | catalog | `true` | first-start import |
| `SNAPSHOT_TIMEOUT_MS` | orders | `2000` | catalog call timeout |
| `PAYMENT_METHOD_TTL_SECONDS` | payments | `1800` | token lifetime |
| `PAYMENT_SIMULATED_LATENCY_MS` | payments | `800` | fake latency |
| `PAYMENT_LIMIT_CENTS` | payments | `1000000` | decline above this |
| `OUTBOX_POLL_INTERVAL_MS` | catalog, orders, payments | `250` | relay period |

Every service validates its environment with zod at boot and exits with code 1 and a readable error if it is invalid. `.env.example` documents all variables. Compose provides the defaults, so no `.env` file is required.

### 13.4 Dockerfile (services)

1. `base`: `node:24-alpine`, `corepack enable`.
2. `deps`: copy `pnpm-lock.yaml` and `pnpm-workspace.yaml`, then `pnpm fetch`.
3. `build`: copy the sources, `pnpm install --offline --frozen-lockfile`, `pnpm turbo build --filter=@stockroom/<svc>...`, then `pnpm deploy --filter=@stockroom/<svc> --prod /out`.
4. `runtime`: `node:24-alpine` with `tini`, user `node`, copy `/out`, `ENTRYPOINT ["/sbin/tini","--"]`, `CMD ["node","dist/main.js"]` (migrations run inside the service before it listens), plus `HEALTHCHECK`.

Target size is under 250 MB per image.

### 13.5 Local development without containers for the apps

- `docker compose up postgres rabbitmq`
- `pnpm install`
- `pnpm db:migrate`
- `pnpm dev`, which runs all services with watch mode and Vite on 5173, with `/api` proxied to the gateway on 3000.

### 13.6 Startup sequence

```
postgres healthy → rabbitmq healthy
  → catalog: migrate → declare AMQP topology → seed (if empty) → ready
  → orders, payments: migrate → declare topology → ready
  → gateway: ready when upstreams ready
  → web
```

Expected cold start on a laptop is under 60 s after images are built.

---

## 14. Security

| Threat | Control |
|---|---|
| SQL injection (for example the `Robert'); DROP TABLE` product) | Parameterized `pg` queries only; dynamic fragments from whitelists; integration test with that exact string |
| Stored XSS (for example the `<script>` product) | React text rendering only; `dangerouslySetInnerHTML` banned by lint; CSP `default-src 'self'`; e2e test asserts no script runs |
| CSV formula injection | Prefixing on error report export (§6.7.6) |
| Oversized or malicious upload | Limits enforced at nginx, gateway and catalog; UTF-8 and NUL sniffing; streaming parser with `max_record_size` |
| Abuse and flooding | Rate limits (§5.4); body limits |
| Card data exposure | Tokenization; PAN and CVC never stored, logged or sent in events; pino redaction |
| Information leakage | 500 responses carry no stack traces; `x-powered-by` disabled |
| Cross-service data access | Database-per-service roles; internal endpoints not routed by the gateway |
| Secrets | None required; local defaults only in `.env.example` and compose; `.env` ignored by git |
| Dependency vulnerabilities | `pnpm audit --prod` in the hardening phase; findings documented |
| Missing authentication ⚠️ | Documented as an explicit non-goal. A banner in the UI. Future work: OIDC (Keycloak in compose) with an admin role |

---

## 15. Observability and operations

### 15.1 Logging
- JSON lines through pino.
- Base fields: `level`, `time`, `service`, `version`, `correlationId`, `msg`.
- Request logs add `method`, `url`, `statusCode` and `responseTimeMs`.
- Message logs add `eventType`, `messageId`, `attempt`, `orderId` and `sku` where relevant.
- Redaction: `req.headers.authorization`, `*.cardNumber`, `*.cvc`.

### 15.2 Correlation
- The gateway sets `x-request-id`. Services store it in AsyncLocalStorage, so it appears in every log line.
- Outbox rows copy it as `correlationId`. Consumers restore it into AsyncLocalStorage, so a single order can be traced across all services with `docker compose logs | grep <id>`.

### 15.3 Health
- `/health/live`: process up.
- `/health/ready`: database query `SELECT 1`, AMQP channel open, and the outbox backlog (unpublished rows older than 60 s) under 1000.

### 15.4 Operational tooling
- RabbitMQ management UI at http://localhost:15672 (stockroom/stockroom) to inspect queues and DLQs.
- Optional stretch goal: an OpenTelemetry SDK exporting to a Jaeger container under the compose profile `observability`.

### 15.5 Graceful shutdown
- On SIGTERM:
  1. Stop accepting HTTP requests.
  2. Cancel consumers.
  3. Wait for in-flight handlers, up to 10 s.
  4. Stop the outbox relay and sweeper.
  5. Close the AMQP connection and the pg pool.
  6. Exit with code 0.

---

## 16. Performance targets and limits

| Metric | Target | How verified |
|---|---|---|
| `GET /products` search, p95 | < 300 ms with 10k products | T6.5: seed script + `autocannon` (50 connections, 30 s) + `EXPLAIN ANALYZE` |
| `GET /products/:id`, p95 | < 100 ms | autocannon |
| Import of the example CSV | < 1 s | integration test timing |
| Import of 50k rows | < 30 s, memory < 256 MB | manual benchmark, documented |
| `POST /orders` → CONFIRMED (approve card, default latency) | < 3 s end to end | e2e |
| Concurrent last-unit purchase | exactly 1 success out of 20 | T9.5 |
| Container cold start | < 60 s for the whole stack | T11.6 |

Hard limits: page size 100; `q` 100 characters; upload 5 MB / 50k rows; 50 order lines; quantity 99; price 999,999.99; stock 1,000,000.

---

## 17. Testing specification

### 17.1 Levels and locations

| Level | Location | Runner | Infra |
|---|---|---|---|
| Unit | `src/**/*.spec.ts` | Vitest | none |
| Integration | `test/integration/**/*.int.spec.ts` | Vitest (separate project, `pool: forks`, 60 s timeout) | Testcontainers Postgres 17 and RabbitMQ 4 |
| HTTP | `test/http/**/*.http.spec.ts` | Vitest + Supertest | Testcontainers |
| Contract | `packages/contracts/test/**` | Vitest | none |
| Saga | `services/orders/test/saga/**` | Vitest | Testcontainers plus the three Nest apps in-process |
| Component | `apps/web/src/**/*.test.tsx` | Vitest + jsdom + Testing Library + MSW + vitest-axe | none |
| E2E | `apps/web/e2e/**` | Playwright | docker compose |

### 17.2 Required test cases

**Money and parsing (unit, property-based)**
- `parseMoney`:
  - `"19.99"` → 1999; `"$29.99"` → 2999; `"0.00"` → 0; `"1,299.00"` → 129900
  - Rejects `"free"`, `"1.999"`, `"-1"` and `""`
- For random integers n, `format(parse(n))` round-trips to n.

**CSV (unit plus integration)**
- One fixture per row in the data profile, asserting the exact error code and field.
- Header variations: different case, extra spaces, reordered columns, an unknown extra column (warning), a missing column (422 and nothing written).
- BOM, CRLF, missing trailing newline, quoted commas, escaped quotes, UTF-8 `—™`.
- Oracle: the example file gives the exact counters in §6.7.5; re-import gives the counters in the re-import column.
- Error CSV export escapes formulas.

**Products (unit, integration, HTTP)**
- Invariants, create with duplicate SKU (409), update with a stale version (409), update without `If-Match` (428).
- Stock below reserved (409), soft delete hides the product from list and search, delete with reservations (409).

**Search (integration)**
- Every expectation in the table in §6.6, plus filter combinations and pagination boundaries (last page, a page beyond the end returns empty data).

**Inventory (integration)**
- Reserve all-or-nothing across multiple lines.
- Concurrency: 20 parallel reservations for stock 1 → exactly 1 reserved, `reserved ≤ stock` always.
- Commit, release, expire, and commit after expire (both success and failure).
- Duplicate events are no-ops.

**Orders and payments**
- Every cell of the state machine table in §7.1.
- Idempotency: same key and same body → one order; same key and a different body → 422; concurrent same key → one order.
- Price change → 409. Catalog down → 503, and the circuit opens after 5 failures.
- Every payment rule in §8.1, including `FAIL_ONCE` retry and `LIMIT_EXCEEDED`.

**Messaging (integration)**
- The outbox survives a crash before publish.
- Duplicate delivery runs the handler once. A schema-invalid message lands in the DLQ. A transient error is retried, then lands in the DLQ after 3 attempts.

**Saga (cross-service)**
- Happy path, out of stock, declined card, payments down then recovered, reservation expiry with a late payment (refund requested), zero-total order.

**Frontend (component)**
- Form validation and server error mapping, version-conflict dialog, delete dialog.
- Search URL sync and debounce, import dropzone validation and the summary view.
- Cart math and caps, checkout double-submit guard and `PRICE_CHANGED` flow, every order status variant.
- axe reports no violations on the main pages.

**E2E**
- Admin CRUD, including a conflict between two tabs.
- Search with filters and a shareable URL.
- Import of the example file and of a bad-header file.
- Purchase with 4242 (confirmed), 0002 (declined) and last-unit contention.
- The XSS product is shown as text and no dialog fires.

### 17.3 Test conventions
- Builders: `aProduct()`, `anOrder()`, `anEvent()`.
- Fixed clock and id generator injected.
- Asynchronous assertions use `waitFor(condition, { timeout })`. No sleeps.
- Each integration suite truncates its tables between tests.

### 17.4 Coverage
- At least 80% line coverage on `domain` and `application` per service, and on `packages/contracts` and `packages/platform`. Reported with `vitest --coverage` (v8).

---

## 18. Traceability

| Spec section | Requirements | Use cases | Plan tasks |
|---|---|---|---|
| §4.4 Money, §4.5 Weight | R2, R3, R5 | UC-04, UC-07, UC-10 | T3.6, T5.1, T7.2 |
| §5 Gateway | R6, R7 | all | T4.2, T9.16, T11.1 |
| §6.3–6.5 Products and categories | R1, R2 | UC-01, UC-03–06 | T5.1–T5.6 |
| §6.6 Search | R4 | UC-02 | T6.1–T6.5 |
| §6.7 CSV import | R3, R12 | UC-07, UC-08 | T7.1–T7.7 |
| §6.8 Inventory | R5 | UC-10, UC-14 | T9.1–T9.5 |
| §6.9 Snapshot | R5 | UC-10 | T9.6 |
| §6.10 Seeding | R3, R12 | UC-15 | T7.8 |
| §7 Orders | R5 | UC-10, UC-12, UC-13 | T9.7–T9.11 |
| §8 Payments | R5 | UC-11 | T9.12–T9.14 |
| §9 Messaging and saga | R5 | UC-10, UC-11, UC-14 | T8.1–T8.6, T9.15 |
| §10 API | R2–R5 | all | T5.6, T6.3, T7.7, T9.11 |
| §11 Errors | R13 | all | T3.3 |
| §12 Frontend | R6 | all | T4.3, T5.7–T5.11, T6.6, T7.9, T10.1–T10.6 |
| §13 Runtime | R7, R11 | UC-15 | T2.1–T2.6, T4.4–T4.6, T11.6 |
| §14 Security | R13 | UC-07 | T7.11, T11.1 |
| §15 Observability | R13 | — | T3.2, T3.5, T8.5, T11.2, T11.3 |
| §16 Performance | R4, R13 | UC-02 | T6.5, T11.6 |
| §17 Testing | R13 | all | test tasks in every phase, T12.* |

---

## 19. Assumptions and open decisions

Each item is applied in this spec with the proposed default. Changing one updates the listed sections.

| # | Decision | Proposed default | Affects |
|---|---|---|---|
| 1 | Authentication | None; admin and shop split by route, with a banner | §1.3, §12.2, §14, ADR 0009 |
| 2 | Cart model | Multi-item, client-side in localStorage | §12.5, UC-09 |
| 3 | Re-import of existing SKUs | Upsert; restore soft-deleted products | §6.7.4 |
| 4 | Categories | Dynamic, created on first use | §6.5 |
| 5 | SKU mutability | Immutable after creation | §6.2, §10.1 |
| 6 | Out-of-stock visibility | Shown with a badge, not purchasable | §6.6, §12 |
| 7 | Zero-total orders | Skip payment, confirm after reservation | §7.1, §7.4 |
| 8 | Reservation TTL and late payment | 10 min; a late success triggers a refund | §6.8, §7.1 |
| 9 | Fake payment rules | Test cards in §8.1 plus the 10,000.00 limit | §8.1 |
| 10 | `$` in CSV price | Normalize and accept | §4.4, §6.7.3 |
| 11 | Empty CSV category | Reject the row | §6.7.3 |
| 12 | Empty CSV weight | Accept as null | §6.7.3 |
| 13 | Markup or SQL-like names | Store literally, encode on output | §4.7, §14 |
| 14 | Duplicate SKUs in one file | Last wins, with a warning | §6.7.3 |
| 15 | Price changed between cart and order | 409 `PRICE_CHANGED`, user reconfirms | §7.3, §12.5 |
| 16 | Import processing mode | Synchronous with a job resource; async later | §6.7.1 |
| 17 | Currency | USD only | §4.4 |
| 18 | CSV download date | 2026-10-05 | README, `docs/csv-data-profile.md` |

---

## 20. Technology stack decisions

This section explains each technology choice: what was chosen, why, what else was considered and why it lost, and what the choice costs. Architecture-level decisions are summarized in §2.5 and recorded as ADRs. Library-level decisions live here.

### 20.1 Selection criteria

Every candidate was scored against these criteria, in priority order:

1. **Fit for the quality goals** (§1.2): correctness of money and stock, import integrity, one-command local run.
2. **Runs fully offline in Docker** on macOS (arm64) and Linux (amd64), with no licences or cloud accounts.
3. **Type safety end to end.** One schema definition shared by the UI, services and messages.
4. **Maturity and community.** Stable releases, active maintenance, good documentation, known failure modes.
5. **Reviewer familiarity.** Mainstream choices make the code easy for evaluators to read.
6. **Delivery speed** for one engineer working with AI in a code-challenge timeframe.

### 20.2 Version policy

- Majors are fixed as listed below. Exact versions are pinned by `pnpm-lock.yaml` at scaffold time (T1.1) and never floated.
- Docker base images are pinned to a minor tag (`node:24-alpine`, `postgres:17-alpine`, `rabbitmq:4-management-alpine`, `nginx:1.27-alpine`).
- Node 24 is the Active LTS line. The local machine has Node 25, which is fine for tooling, but `engines` and `.nvmrc` enforce 24 for parity with containers.

### 20.3 Stack summary

| Layer | Choice | Major | Alternatives considered |
|---|---|---|---|
| Language | TypeScript | 5.x | Java/Kotlin, Go, Python |
| Runtime | Node.js | 24 LTS | Bun, Deno |
| Monorepo | pnpm workspaces + Turborepo | pnpm 10, turbo 2 | Nx, npm/yarn workspaces, polyrepo |
| Backend framework | NestJS | 11 | Fastify standalone, Express, Hono |
| HTTP adapter | Fastify (via `@nestjs/platform-fastify`) | 5 | Express |
| Database | PostgreSQL | 17 | MySQL 8, MongoDB, SQLite |
| Data access / migrations | node-postgres (`pg`) + SQL migration runner in `@stockroom/platform` | pg 8 | Prisma, Kysely, TypeORM, Drizzle, MikroORM |
| Search | PostgreSQL FTS + pg_trgm | — | Meilisearch, Typesense, OpenSearch |
| Message broker | RabbitMQ | 4 | Kafka/Redpanda, NATS JetStream, Redis Streams |
| AMQP client | `amqplib` + `amqp-connection-manager` | — | `@golevelup/nestjs-rabbitmq`, NestJS microservices transport |
| Validation and contracts | zod + `nestjs-zod` | zod 4 | class-validator, TypeBox, Valibot |
| API docs | OpenAPI 3.1 generated from zod (`nestjs-zod` + `@nestjs/swagger`) | — | Hand-written OpenAPI, tRPC |
| Gateway proxy | `@fastify/http-proxy` inside the NestJS gateway | — | nginx/Traefik as gateway, Kong, `http-proxy-middleware` |
| Resilience | `cockatiel` (timeout, retry, circuit breaker) | 3 | `opossum`, hand-written |
| HTTP client | Native `fetch` (undici) | — | axios, got |
| Logging | `pino` via `nestjs-pino` | — | Winston, Nest default logger |
| CSV parsing | `csv-parse` (stream API) | 5 | Papa Parse, fast-csv |
| Multipart upload | `@fastify/multipart` (streamed) | — | multer (Express only) |
| IDs | UUID v7 (`uuid` package) | 11 | UUID v4, ULID, bigserial |
| Frontend framework | React | 19 | Vue 3, Angular, Svelte |
| Build tool | Vite | current major | Next.js, CRA (deprecated), Rsbuild |
| Routing | React Router (data router) | 7 | TanStack Router |
| Server state | TanStack Query | 5 | Redux Toolkit Query, SWR, plain `useEffect` |
| Forms | react-hook-form + `@hookform/resolvers/zod` | 7 | Formik, TanStack Form |
| UI and styling | Tailwind CSS + shadcn/ui (Radix primitives) | Tailwind 4 | MUI, Chakra, Mantine |
| Static serving | nginx | 1.27 | `vite preview`, Node static server |
| Unit/integration tests | Vitest (+ `unplugin-swc` for decorators) | current major | Jest |
| DB/broker in tests | Testcontainers for Node | — | docker-compose test profile, in-memory fakes, pg-mem |
| HTTP tests | Supertest | — | Pactum, raw fetch |
| Component tests | Testing Library + MSW + vitest-axe | MSW 2 | Enzyme, Cypress component testing |
| E2E | Playwright | current major | Cypress, Selenium |
| Property tests | fast-check | — | none |
| Load checks | autocannon | — | k6, JMeter |
| Lint/format | ESLint (flat config, typescript-eslint strict) + Prettier | ESLint 9 | Biome |
| Git hooks | lefthook + commitlint | — | husky + lint-staged |
| Containers | Docker multi-stage + Docker Compose v2 | — | Podman, Tilt, k8s (kind) |

### 20.4 Decision records per layer

#### TD-01 Language and runtime: TypeScript on Node.js 24 LTS
- **Why:** one language across UI, services and contracts, so a single zod schema validates the HTTP body in the browser, at the API, and in event payloads. This removes a whole class of contract-drift bugs. Node is a good fit for I/O-bound services (HTTP, Postgres, AMQP).
- **Alternatives:**
  - *Java/Spring Boot*: strongest "enterprise" signal and mature transactions, but two languages, more boilerplate and slower iteration.
  - *Go*: small, fast containers, but no shared types with the UI and more hand-written plumbing.
  - *Python/FastAPI*: fast to write, but weaker typing guarantees at runtime boundaries and two languages.
  - *Bun/Deno*: faster tooling, but less mature compatibility with NestJS and the Node ecosystem.
- **Trade-offs:** CPU-heavy work (large CSVs) shares the event loop; this is mitigated by streaming and batching (§6.7) and the 5 MB limit. Using numbers for cents is safe only up to 2^53, which is far above the 999,999.99 limit.

#### TD-02 Monorepo: pnpm workspaces + Turborepo
- **Why:** atomic changes across contracts and services, one lockfile, strict dependency isolation (pnpm does not hoist undeclared dependencies), and `pnpm deploy` produces lean per-service production bundles for Docker. Turborepo adds cached, dependency-aware `build`/`test`/`lint` with almost no configuration.
- **Alternatives:**
  - *Nx*: more powerful (generators, module-boundary lint), but heavier and more opinionated.
  - *npm/yarn workspaces*: weaker isolation and slower installs.
  - *Polyrepo*: realistic for independent teams, but shared contracts would need publishing, which is overkill here.
- **Trade-offs:** services are independently deployable but not independently versioned. That is acceptable for a single team, and documented.

#### TD-03 Backend framework: NestJS 11 on Fastify
- **Why:**
  - Its module and DI system maps directly to hexagonal ports and adapters (injection tokens for ports, swappable fakes in tests).
  - It provides first-class building blocks: lifecycle hooks for graceful shutdown, health checks, OpenAPI.
  - It is recognizable to reviewers, and its structure is consistent across all four services.
  - The Fastify adapter gives lower overhead and native streaming multipart.
- **Alternatives:**
  - *Plain Fastify or Hono*: lighter and faster, but every team would invent its own structure, DI and testing seams.
  - *Express adapter*: largest ecosystem, but slower, and multer buffers uploads instead of streaming them.
- **Trade-offs:**
  - Decorators need SWC in Vitest.
  - Some Express-only middleware is unavailable, so Fastify plugins are used instead: `@fastify/helmet`, `@fastify/cors`, `@fastify/multipart`, `@fastify/http-proxy`.
  - The DI container adds a little startup time, which is negligible.

#### TD-04 Database: PostgreSQL 17, one database per service
- **Why:**
  - ACID transactions are needed for the outbox pattern and for atomic conditional stock updates.
  - `CHECK` constraints enforce invariants in the database: no negative stock, `reserved ≤ stock`.
  - Native full-text search and trigram indexes avoid an extra search engine.
  - `FOR UPDATE SKIP LOCKED` supports the outbox relay and the sweeper. `citext`, generated columns and partial indexes are also available.
  - One container with three databases and three roles gives real data isolation at a low local cost.
- **Alternatives:**
  - *MySQL 8*: viable (it has `SKIP LOCKED`), but weaker full-text ranking, no trigram index, and no equivalent of a weighted generated tsvector.
  - *MongoDB*: flexible schema suits messy CSV, but multi-document transactions and conditional stock updates are clumsier, and there is no relational integrity for order lines.
  - *SQLite*: simplest, but a single writer and file-based storage conflict with multiple services.
- **Trade-offs:** in production each service would get its own cluster. Locally they share one instance, documented as a deployment shortcut rather than an architectural coupling.

#### TD-05 Data access and migrations: node-postgres + SQL migrations (revised during implementation)
- **Why:**
  - Almost every critical query is hand-written SQL anyway: weighted full-text and trigram search, conditional stock updates, `FOR UPDATE SKIP LOCKED` outbox relay, `unnest` batch upserts, advisory locks.
  - No code generation and no native engine binaries, so the pnpm monorepo has no client-collision problem and Alpine/arm64 images stay simple.
  - The DDL in this spec is literally the migration file, which keeps spec and code in sync.
  - `@stockroom/platform` provides `Database.transaction`, `runMigrations` (advisory-locked, transactional, recorded in `schema_migrations`) and `isUniqueViolation`.
- **Alternatives:**
  - *Prisma (original choice)*: great typed CRUD, but generated clients collide in the shared pnpm store unless every service sets a custom output; engine binaries complicate musl/arm64 images; most queries here would bypass it through raw SQL anyway.
  - *Kysely*: type-safe query builder; more type safety for more code and API surface. A good upgrade path if the schema grows.
  - *TypeORM / MikroORM*: unit-of-work ORMs, heavier and less transparent for the concurrency-sensitive paths.
- **Trade-offs:** row types are written by hand, so drift is caught by integration tests (Testcontainers) instead of the compiler. Accepted for this scale.

#### TD-06 Search: PostgreSQL FTS + pg_trgm
- **Why:** the dataset is small (95 rows in the example, about 10k in the load target). Postgres gives relevance ranking, typo tolerance and filters in the same transaction as writes, so results are never stale and there is no sync pipeline.
- **Alternatives:**
  - *Meilisearch/Typesense*: better relevance and facets out of the box, but an extra container plus an indexing pipeline (outbox → indexer) that brings eventual consistency.
  - *OpenSearch/Elasticsearch*: very powerful, but heavy (1–2 GB RAM) for a local demo.
- **Trade-offs:** relevance tuning is manual. Beyond about 1M rows or with complex faceting, the ADR names Meilisearch as the upgrade path behind the existing `ProductSearchPort`.

#### TD-07 Messaging: RabbitMQ 4 with amqplib + amqp-connection-manager
- **Why:**
  - Topic exchanges map naturally to `<context>.<entity>.<event>.v<N>` routing keys.
  - Per-consumer queues, dead-lettering, TTL-based retry tiers and publisher confirms cover every reliability need.
  - The management UI makes the saga visible to reviewers.
  - It is lightweight in Docker.
  - `amqp-connection-manager` adds automatic reconnection and channel re-setup on top of the battle-tested `amqplib`.
- **Alternatives:**
  - *Kafka/Redpanda*: a log with replay, ideal for event sourcing and high throughput, but heavier, with more complex consumer semantics and no per-message retry or DLQ without extra tooling.
  - *NATS JetStream*: light and fast, but less familiar.
  - *Redis Streams*: simple, but weaker routing and DLQ ergonomics.
  - *NestJS microservices RMQ transport*: hides too much (no control of exchanges, DLX or confirms).
  - *@golevelup/nestjs-rabbitmq*: convenient, but adds an abstraction over exactly the parts we want explicit.
- **Trade-offs:** no message replay. This is acceptable because the outbox tables are the durable record. Ordering is per-queue only; handlers rely on state-machine guards, not ordering (§7.1).

#### TD-08 Validation and contracts: zod + nestjs-zod
- **Why:**
  - One schema gives runtime validation, TypeScript types and OpenAPI.
  - The same schema is used by react-hook-form, the Nest pipes and the message consumers.
  - It is composable for the CSV row rules.
- **Alternatives:**
  - *class-validator/class-transformer*: the Nest default, but its decorators cannot be reused in the browser, and types and validation can drift.
  - *TypeBox*: JSON Schema native and fast, but less ergonomic for transforms such as SKU normalization.
  - *Valibot*: smaller bundle, but a smaller ecosystem.
  - *tRPC*: great type sharing, but not REST, so worse for an evaluated public API and for OpenAPI consumers.
- **Trade-offs:** zod parsing is slower than compiled validators, which is irrelevant at this scale. The zod 4 and `nestjs-zod` compatibility is verified at scaffold time (T3.4); the fallback is the `zod-to-openapi` plus custom pipe combination.

#### TD-09 Gateway: NestJS + @fastify/http-proxy
- **Why:**
  - It keeps edge concerns in TypeScript, sharing the platform package: correlation id, problem+json for upstream errors, throttling, aggregated OpenAPI.
  - Proxying is streaming, so multipart uploads pass through without buffering.
- **Alternatives:**
  - *nginx or Traefik as the gateway*: faster and battle-tested, but problem+json errors, correlation logic and OpenAPI aggregation would need extra modules or Lua.
  - *Kong/KrakenD*: a full API gateway is overkill locally.
- **Trade-offs:** an extra Node hop of about 1–2 ms. nginx still sits in front for static assets and same-origin `/api`.

#### TD-10 Resilience and HTTP client: cockatiel + native fetch
- **Why:** `cockatiel` composes timeout, retry with jittered backoff and a circuit breaker as typed policies, and is used for the orders → catalog snapshot call. Native `fetch` (undici) needs no dependency and supports `AbortSignal` timeouts.
- **Alternatives:**
  - *opossum*: a popular breaker, but retry and timeout must be composed separately.
  - *axios*: interceptors are nice, but it is an extra dependency with little gain.
- **Trade-offs:** policies are in-process, so they are not shared across replicas. That is fine with one replica per service locally.

#### TD-11 Logging: pino via nestjs-pino
- **Why:** structured JSON with very low overhead, built-in redaction for card fields, request logging, and AsyncLocalStorage integration for the correlation id.
- **Alternatives:**
  - *Winston*: flexible, but slower and noisier to configure.
  - *Nest default logger*: not structured.
- **Trade-offs:** raw JSON is hard to read in a terminal. `pino-pretty` is enabled only in `pnpm dev`.

#### TD-12 CSV parsing: csv-parse (stream) + @fastify/multipart
- **Why:**
  - Strict RFC 4180 compliance: quoted commas, escaped quotes, CRLF and BOM, all present in the example file.
  - The streaming API keeps memory flat for 50k rows. `max_record_size` and an explicit header callback are available.
  - `@fastify/multipart` streams the upload straight into the parser.
- **Alternatives:**
  - *Papa Parse*: excellent in the browser, but the Node streaming API is less idiomatic.
  - *fast-csv*: good, but less control over malformed-row reporting.
- **Trade-offs:** parsing is CPU-bound on the event loop. Batches yield to the loop between transactions, and limits cap the cost.

#### TD-13 Identifiers: UUID v7
- **Why:** generated by the application before insert (so the outbox and events can reference ids inside the same transaction). Time-ordered, so B-tree indexes stay compact. No information leaks from sequential integers.
- **Alternatives:**
  - *UUID v4*: random, which fragments indexes.
  - *ULID*: similar, but not a native Postgres `uuid` type.
  - *bigserial*: the id is only known after insert and is enumerable.
- **Trade-offs:** 16 bytes per id, which is negligible.

#### TD-14 Frontend: React 19 + Vite + React Router 7 (SPA)
- **Why:**
  - The UI is an authenticated-style app with no SEO needs, so an SPA served by nginx is the simplest runtime: static files, no Node server.
  - Vite gives fast dev and production builds.
  - React is the most familiar choice for reviewers.
  - React Router 7's data router gives route-level error boundaries and loaders.
- **Alternatives:**
  - *Next.js*: SSR and server actions add a Node runtime and blur the gateway boundary for no user benefit here.
  - *Angular*: cohesive, but heavier and slower to build.
  - *Vue/Svelte*: equally capable, but less common in evaluator pools.
  - *TanStack Router*: excellent type-safe search params, but less familiar. The URL state hook covers the need.
- **Trade-offs:** no SSR, so the first paint depends on the JS bundle. This is mitigated by route-level code splitting and a bundle under 250 KB gzipped (NFR-PERF-05).

#### TD-15 Server state, forms and UI kit
- **TanStack Query 5:**
  - Caching, deduplication, background refetch, `keepPreviousData` for search, and `refetchInterval` for order polling.
  - Removes hand-written loading/error logic.
  - *Alternatives:* RTK Query (needs Redux for no gain) and SWR (fewer mutation features).
- **react-hook-form + zod resolver:**
  - Uncontrolled inputs keep re-renders low.
  - The same zod schemas as the API are used.
  - Server `errors[]` map onto fields with `setError`.
  - *Alternatives:* Formik (slower, less maintained) and TanStack Form (younger).
- **Tailwind 4 + shadcn/ui:**
  - Accessible Radix primitives (dialogs, selects, focus management).
  - The component code is copied into the repo, so it is fully owned and themable without a runtime CSS-in-JS cost.
  - *Alternatives:* MUI (heavy, opinionated look) and Chakra/Mantine (runtime styling).
- **Trade-offs:** utility-class verbosity is mitigated by small composed components.

#### TD-16 Testing toolchain
- **Vitest:** one runner for backend and frontend, native TypeScript/ESM, fast watch mode. `unplugin-swc` supports Nest decorators. *Alternative:* Jest (Nest default; slower, with awkward ESM setup).
- **Testcontainers:** real Postgres 17 and RabbitMQ 4 per suite, so behaviour matches production. It catches raw-SQL, constraint and broker issues that fakes hide. *Alternatives:* pg-mem (no tsvector or `SKIP LOCKED`) and a shared compose test stack (state leaks between runs).
- **Playwright:** reliable auto-waiting, parallelism, traces on failure, and multi-tab contexts for the version-conflict test. *Alternative:* Cypress (single-tab limits, slower parallelism).
- **MSW:** the same handlers serve component tests and optional dev mocking.
- **fast-check:** property tests for money and SKU parsing, where hand-picked examples miss edge cases.
- **Trade-offs:** Docker is required for integration tests. This is already a prerequisite for running the app.

#### TD-17 Quality gates: ESLint flat config + Prettier + lefthook + commitlint
- **Why:**
  - typescript-eslint strict catches unsafe `any` flows and floating promises.
  - Custom rules enforce the challenge's **no-comments** rule and ban `dangerouslySetInnerHTML` and `console`.
  - lefthook runs fast parallel pre-commit checks.
  - commitlint keeps a readable, Conventional Commits history for evaluators.
- **Alternatives:** Biome (much faster, but cannot express the custom no-comments and import-boundary rules yet), and husky + lint-staged (equivalent, more files).
- **Trade-offs:** ESLint is slower on large repos, which is not an issue at this size thanks to Turborepo caching.

#### TD-18 Containers: Docker multi-stage + Compose v2
- **Why:**
  - It meets the "runnable as a Docker container" requirement.
  - One command starts everything, with `depends_on: service_healthy` for deterministic startup.
  - Multi-stage builds with `pnpm deploy` keep images small and non-root.
- **Alternatives:**
  - *Single all-in-one container*: matches the requirement literally, but contradicts the service boundaries.
  - *kind/k8s or Tilt*: more realistic for production, but too heavy for reviewers.
- **Trade-offs:** about 7 containers need roughly 2 GB RAM. This is documented in the README prerequisites, with a `docker stats` baseline recorded in T11.6.

### 20.5 Technology risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| zod 4 / nestjs-zod / Swagger compatibility gaps | Medium | Medium | Spike in T3.4. Fallback: `@asteasolutions/zod-to-openapi` plus a custom pipe |
| Hand-written SQL drifts from DTO types | Medium | Medium | Row types per repository; integration tests against real Postgres for every repository |
| Native binaries in Alpine images | Low | Medium | No native runtime dependencies (pure-JS `pg`); images built and run on arm64 |
| Vitest + Nest decorators | Low | Medium | `unplugin-swc` configured once in the shared Vitest preset (T1.6) |
| Testcontainers slow on laptops | Medium | Low | Reuse one container per test file; `TESTCONTAINERS_REUSE_ENABLE` locally; integration tests run in a separate Vitest project |
| Node 25 locally vs Node 24 in images | Low | Low | `.nvmrc` and the `engines` field (`>=24`) |
| Large dependency surface | Medium | Medium | `pnpm audit --prod`; minimal dependency policy; lockfile reviewed |
| Breaking majors during the challenge | Low | Medium | Lockfile pinning; Renovate deliberately not enabled during the challenge |

---

## 21. Non-functional requirements and mitigations

Each NFR is measurable, linked to the risk it addresses, and mitigated by named mechanisms specified elsewhere in this document. Verification shows how compliance is proven. Categories follow ISO/IEC 25010.

### 21.1 Summary

| ID | Category | Requirement | Target |
|---|---|---|---|
| NFR-COR-01 | Functional correctness | No overselling | 0 orders confirmed beyond stock under any concurrency |
| NFR-COR-02 | Functional correctness | Exact money arithmetic | 0 float operations on money; totals equal Σ lines exactly |
| NFR-COR-03 | Functional correctness | Exactly-once business effect per purchase | 1 order per Idempotency-Key; 1 charge per order |
| NFR-COR-04 | Functional correctness | Import determinism | Same file → same final state and counters, every time |
| NFR-REL-01 | Reliability | No lost state changes between services | 0 lost events across crashes and broker outages |
| NFR-REL-02 | Reliability | Self-healing checkout | Every order reaches a terminal state within TTL + 60 s |
| NFR-REL-03 | Reliability | Fault isolation | One service down does not crash the others; read paths keep working |
| NFR-REL-04 | Reliability | Graceful shutdown | 0 half-processed messages on SIGTERM |
| NFR-PERF-01 | Performance | Search latency | p95 < 300 ms at 10k products, 50 concurrent clients |
| NFR-PERF-02 | Performance | Product read latency | p95 < 100 ms |
| NFR-PERF-03 | Performance | Import throughput and memory | 50k rows < 30 s, RSS < 256 MB |
| NFR-PERF-04 | Performance | Checkout completion | PENDING → CONFIRMED < 3 s (default latency) |
| NFR-PERF-05 | Performance | UI load | Initial JS < 250 KB gzipped; LCP < 2.5 s locally |
| NFR-SCL-01 | Scalability | Horizontal scale readiness | Stateless services; competing consumers safe; no in-memory shared state |
| NFR-SEC-01 | Security | Injection resistance | 0 SQL/XSS/formula injection paths (example CSV payloads included) |
| NFR-SEC-02 | Security | Sensitive data protection | Card number and CVC never persisted, logged or sent in events |
| NFR-SEC-03 | Security | Abuse resistance | Rate and size limits on every public endpoint |
| NFR-SEC-04 | Security | Least privilege | Each service can reach only its own database; containers run as non-root |
| NFR-DAT-01 | Data integrity | Invariants enforced in the database | Constraint violations impossible even with buggy code |
| NFR-DAT-02 | Data integrity | Lost-update prevention | Concurrent admin edits detected 100% of the time |
| NFR-OBS-01 | Observability | End-to-end traceability | Any order traceable across all services by one id |
| NFR-OBS-02 | Observability | Health signalling | Liveness and readiness on every service; compose waits on readiness |
| NFR-MNT-01 | Maintainability | Modularity | Domain layer has 0 framework imports; services share only contracts and platform |
| NFR-MNT-02 | Maintainability | Code standards | 0 lint errors, 0 `any`, 0 code comments |
| NFR-MNT-03 | Maintainability | Documented decisions | Every significant decision has an ADR or TD entry with alternatives |
| NFR-TST-01 | Testability | Coverage of critical logic | ≥ 80% line coverage on domain and application; every spec scenario has a test |
| NFR-TST-02 | Testability | Deterministic tests | 0 flaky tests across 2 consecutive full runs |
| NFR-DEP-01 | Deployability | One-command start | `docker compose up --build` from a fresh clone, no manual steps |
| NFR-DEP-02 | Deployability | Fast, small, portable images | Each image < 250 MB; stack ready < 60 s; amd64 and arm64 |
| NFR-CMP-01 | Compatibility | Stable, versioned contracts | No breaking API or event change without a new version |
| NFR-USA-01 | Usability | Clear feedback | Every async view has loading, empty and error states; every failure explained |
| NFR-USA-02 | Accessibility | WCAG 2.2 AA on core flows | 0 axe violations; keyboard-only operable |
| NFR-USA-03 | Usability | Responsive UI | Usable at 360 px width and above |

### 21.2 Detail: requirement, risk, mitigation, verification

#### Functional correctness

**NFR-COR-01 No overselling**
- *Risk:* two shoppers buy the last unit at once; lost updates on stock; orders confirmed after a reservation expired.
- *Mitigations:*
  - Conditional atomic `UPDATE ... WHERE stock - reserved >= qty` (§6.8).
  - Row locks in sorted id order, to avoid deadlocks.
  - DB `CHECK (reserved <= stock)` and `CHECK (stock >= 0)` as the last line of defence (§6.3).
  - All-or-nothing reservation for multi-line orders.
  - Commit after expiry re-checks availability and triggers cancel and refund on failure (§6.8, §7.1).
- *Verification:* T9.5 concurrency test (20 parallel orders, stock 1 → exactly 1); saga suite for expiry with a late payment; E2E last-unit contention (T12.5).

**NFR-COR-02 Exact money arithmetic**
- *Risk:* float drift (`0.1 + 0.2`), CSV values such as `$29.99` or `1,299.00` mis-parsed.
- *Mitigations:*
  - Integer cents end to end (§4.4); BIGINT columns.
  - String-based `parseMoney` shared by CSV, API and UI.
  - The UI never computes totals; the server's totals are authoritative.
  - `expectedTotalCents` check before placing an order (§7.3).
- *Verification:* fast-check property tests; CSV fixtures; an integration test asserting `total = Σ line_total`.

**NFR-COR-03 Exactly-once business effect**
- *Risk:* double clicks, client retries, at-least-once message delivery causing duplicate orders or charges.
- *Mitigations:*
  - `Idempotency-Key` with a request hash on orders (§7.3).
  - Unique `payments.order_id` (§8.2).
  - `processed_messages` dedupe for every consumer (§9.5).
  - A state-machine guard ignores repeated transitions (§7.1).
  - The UI keeps the key per attempt and disables double submit (§12.5).
- *Verification:* HTTP tests for replay, key reuse and a concurrent same key; duplicate-delivery integration test; E2E double-click.

**NFR-COR-04 Import determinism**
- *Risk:* the dirty example CSV produces different results on re-run; partial imports leave an unknown state.
- *Mitigations:*
  - Pure normalization functions (§6.7.3).
  - Last-wins in-file dedupe.
  - Upsert by SKU with an `unchanged` classification.
  - Per-batch transactions; the job status records partial failure; re-running is safe (§6.7.4).
- *Verification:* the oracle test (§6.7.5) on a fresh database and on re-import.

#### Reliability

**NFR-REL-01 No lost state changes**
- *Risk:* a crash between DB commit and publish; broker down; consumer crash mid-handle.
- *Mitigations:*
  - Transactional outbox (§9.4); publisher confirms; persistent messages on durable queues.
  - Manual ack only after the DB commit (§9.5).
  - Retry tiers and a DLQ for poison messages (§9.3).
- *Verification:* outbox crash-before-publish test; broker restart during the saga test; a DLQ test.

**NFR-REL-02 Self-healing checkout**
- *Risk:* orders stuck in PENDING or AWAITING_PAYMENT because a message was lost or a service was down.
- *Mitigations:*
  - Reservation TTL with the sweeper (§6.8), emitting `reservation-expired` so orders cancel.
  - Retries with backoff.
  - The readiness check flags an outbox backlog (§15.3).
  - UI polling timeout with a "still processing" message (§12.5).
- *Verification:* saga test with payments stopped, asserting CANCELLED `RESERVATION_EXPIRED` within TTL plus the sweep interval (fixed clock).

**NFR-REL-03 Fault isolation**
- *Risk:* a cascading failure from one slow or down service.
- *Mitigations:*
  - Async integration for writes.
  - The single sync call (orders → catalog) has a timeout, retry and circuit breaker, failing fast with 503 (§7.3).
  - The gateway returns 502/504 problem responses with per-upstream timeouts (§5.3).
  - Database-per-service isolation; `restart: unless-stopped`.
- *Verification:* HTTP test with catalog down (503, breaker opens); a manual chaos check (`docker compose stop payments` → catalog browsing still works) recorded in the README.

**NFR-REL-04 Graceful shutdown**
- *Risk:* SIGTERM during a handler leaves the transaction rolled back but the message acked, or vice versa.
- *Mitigations:* the ordered shutdown sequence (§15.5); tini as PID 1 for signal forwarding; ack only after commit.
- *Verification:* T11.2: `docker compose stop` during a load run, then assert no orders are stuck and the DLQ is empty.

#### Performance

**NFR-PERF-01 Search latency**
- *Risk:* sequential scans; trigram on large text; `count(*)` on every page.
- *Mitigations:*
  - GIN on the stored `search_vector`, trigram GIN on name and sku, partial B-tree indexes (§6.3).
  - `count(*) OVER ()` in a single query.
  - Page size capped at 100.
  - Debounced UI requests with `keepPreviousData` (§12.5).
- *Verification:* T6.5 with a 10k seed, autocannon (50 connections, 30 s), and an `EXPLAIN ANALYZE` showing index usage, recorded in the README.

**NFR-PERF-02 Product read latency**
- *Mitigations:* primary-key lookup; Fastify adapter; pino's low logging overhead; TanStack Query caching on the client.
- *Verification:* autocannon on `GET /products/:id`.

**NFR-PERF-03 Import throughput and memory**
- *Risk:* loading the whole file into memory; one round trip per row.
- *Mitigations:* streaming multipart into a streaming parser (TD-12); batches of 500 with set-based SQL (§6.7.4); hard limits on size and rows.
- *Verification:* a generated 50k-row benchmark with `process.memoryUsage()` sampling, results documented.

**NFR-PERF-04 Checkout completion**
- *Mitigations:* outbox relay polling every 250 ms plus a wake-up notifier (§9.4); prefetch 10; simulated latency configurable down to 0 for tests.
- *Verification:* the E2E happy path asserts confirmation within 3 s.

**NFR-PERF-05 UI load**
- *Mitigations:* route-level `lazy()` code splitting; shadcn components tree-shaken; no heavy UI framework; nginx gzip and immutable caching of hashed assets.
- *Verification:* `vite build` size report recorded in T11.6; Lighthouse run documented once.

#### Scalability

**NFR-SCL-01 Horizontal scale readiness**
- *Risk:* singletons break when replicas are added (sweeper, seeder, outbox relay).
- *Mitigations:*
  - Services are stateless; state lives in Postgres and RabbitMQ.
  - The relay uses `FOR UPDATE SKIP LOCKED`; the sweeper and seeder use advisory locks (§6.8, §6.10).
  - Competing consumers are safe thanks to idempotency.
  - The cart lives client-side.
- *Verification:* a manual run with `docker compose up --scale catalog=2 --scale orders=2`, then the saga E2E passes; documented as an optional check.

#### Security

**NFR-SEC-01 Injection resistance**
- *Risk:* the example CSV contains `<script>alert('xss')</script>` and `Robert'); DROP TABLE products;--`; exported error CSVs opened in Excel.
- *Mitigations:* parameterized SQL only; React text rendering with `dangerouslySetInnerHTML` banned by lint; a strict CSP (§12.7); formula-injection escaping on export (§6.7.6).
- *Verification:* an integration test inserting and searching the SQL payload (the table still exists afterwards); an E2E check that no dialog fires and the text is visible; an export escaping unit test.

**NFR-SEC-02 Sensitive data protection**
- *Mitigations:* tokenization (ADR 0011, §8.1); only `last4` is stored; pino redaction paths; the card number never reaches orders or events.
- *Verification:* a unit test on the redaction config; an integration test grepping the payments DB, orders DB and outbox payloads for the test card number, expecting none.

**NFR-SEC-03 Abuse resistance**
- *Mitigations:* gateway rate limits (§5.4); body limits at nginx, the gateway and the services; CSV row and size limits; bounded query parameters (§16).
- *Verification:* an HTTP test for 429; a 413 on oversized upload.

**NFR-SEC-04 Least privilege**
- *Mitigations:* a database role per service with `REVOKE CONNECT FROM PUBLIC` (§13.2); non-root containers; only the web port (and the optional admin UIs) published.
- *Verification:* T2.6 checks that the catalog role is rejected by `orders_db`; `docker inspect` confirms the user is not root.

#### Data integrity

**NFR-DAT-01 Invariants enforced in the database**
- *Mitigations:* `CHECK`, `UNIQUE`, `NOT NULL` and foreign keys on every table (§6.3, §7.2, §8.2); domain invariants duplicated in code to give good error messages.
- *Verification:* integration tests that bypass the domain and assert the database rejects invalid rows.

**NFR-DAT-02 Lost-update prevention**
- *Mitigations:* `version` column with `ETag`/`If-Match`; 428 if the header is missing, 409 if stale (§6.4, §10.1); the UI conflict dialog (§12.5).
- *Verification:* an HTTP test; the two-tab E2E (T12.2).

#### Observability

**NFR-OBS-01 End-to-end traceability**
- *Mitigations:* `x-request-id` carried into AsyncLocalStorage, the outbox `correlationId` and consumer logs (§15.2); order and SKU ids in log context.
- *Verification:* T11.3 places one order and asserts that all four services logged the same correlation id.

**NFR-OBS-02 Health signalling**
- *Mitigations:* `/health/live` and `/health/ready` checking the database, broker and outbox backlog (§15.3); compose healthchecks and `service_healthy` gating (§13.1).
- *Verification:* the smoke script (T4.6); a broker-stop test makes readiness report 503.

#### Maintainability

**NFR-MNT-01 Modularity**
- *Mitigations:* hexagonal layering per module (§6.1); ESLint `no-restricted-imports` blocks framework imports in `domain/` and imports across services; only `contracts` and `platform` are shared.
- *Verification:* lint in pre-commit and in the definition of done.

**NFR-MNT-02 Code standards**
- *Mitigations:* typescript-eslint strict; Prettier; the custom no-comments rule plus the `check-no-comments.sh` hook; final audit T11.7.
- *Verification:* `pnpm lint` clean; the audit script reports 0 findings.

**NFR-MNT-03 Documented decisions**
- *Mitigations:* ADRs 0001–0011; TD-01 to TD-18 (§20); an OpenSpec design.md per change with alternatives (config rule).
- *Verification:* the deliverables checklist (T13.6).

#### Testability

**NFR-TST-01 Coverage of critical logic**
- *Mitigations:* the test pyramid (§17); every OpenSpec scenario mapped to a test (config rule); coverage thresholds in Vitest config fail the run below 80%.
- *Verification:* `pnpm test -- --coverage`.

**NFR-TST-02 Deterministic tests**
- *Mitigations:* injected Clock and IdGenerator; no sleeps (`waitFor` polling); table truncation per test; isolated Testcontainers; Playwright traces on retry.
- *Verification:* T12.7 runs the full suite twice from a clean state.

#### Deployability and portability

**NFR-DEP-01 One-command start**
- *Mitigations:* compose defaults with no `.env` required; migrations and seeding in entrypoints; healthcheck-gated ordering (§13.6).
- *Verification:* T13.5 clean-machine run, following the README verbatim.

**NFR-DEP-02 Fast, small, portable images**
- *Mitigations:* multi-stage builds with `pnpm deploy --prod`; Alpine bases; no native runtime dependencies; layer caching with lockfile-first copies.
- *Verification:* T11.6 records `docker images` sizes and cold-start time.

#### Compatibility

**NFR-CMP-01 Stable, versioned contracts**
- *Mitigations:* `/api/v1` URI versioning; `.v1` event types; additive-only changes within a version; contract tests on example payloads (§17.2); schemas owned by `@stockroom/contracts`.
- *Verification:* contract test suite; OpenAPI diff reviewed in each OpenSpec change.

#### Usability and accessibility

**NFR-USA-01 Clear feedback**
- *Mitigations:* the loading, empty and error state standard (§12.6); human-readable cancellation reasons; import issue reports with line numbers that match spreadsheets; problem+json field errors mapped onto inputs.
- *Verification:* component tests per state; T11.4 audit.

**NFR-USA-02 Accessibility**
- *Mitigations:* Radix primitives; labelled inputs; focus management; AA contrast tokens.
- *Verification:* vitest-axe on main pages; a keyboard-only E2E pass on checkout (T11.5).

**NFR-USA-03 Responsive UI**
- *Mitigations:* Tailwind responsive layouts; tables collapse to cards below 640 px.
- *Verification:* Playwright run at a 360×740 viewport for the shop flows.

### 21.3 Residual risks (accepted)

| Risk | Why accepted | Future mitigation |
|---|---|---|
| No authentication: anyone can reach `/admin` | Not required by the challenge; keeps the focus on the core domain | OIDC with Keycloak in compose, an admin role guard at the gateway |
| Single Postgres instance for all services | Local resource limits | One cluster per service in production |
| Single replica per service locally | Simplicity | Verified scale-out readiness (NFR-SCL-01) |
| Offset pagination | Fine at the target scale | Keyset pagination on `(created_at, id)` |
| No distributed tracing by default | Logs with a correlation id are enough to demonstrate traceability | OpenTelemetry + Jaeger compose profile |
| No message replay (RabbitMQ) | Outbox tables are the durable record | Kafka or event store if event sourcing is needed |
| Refunds are simulated only | Fake provider by requirement | Real provider integration behind the payments port |

### 21.4 NFR → plan tasks

| NFR | Tasks |
|---|---|
| NFR-COR-01 | T9.1, T9.2, T9.4, T9.5, T9.15, T12.5 |
| NFR-COR-02 | T3.6, T7.2, T9.9 |
| NFR-COR-03 | T8.4, T9.9, T9.13, T10.3 |
| NFR-COR-04 | T7.5, T7.6 |
| NFR-REL-01 | T8.2, T8.3, T8.4, T8.6 |
| NFR-REL-02 | T9.4, T9.10, T9.15, T10.4 |
| NFR-REL-03 | T4.2, T9.9, T11.1 |
| NFR-REL-04 | T11.2 |
| NFR-PERF-01..05 | T6.1, T6.2, T6.5, T7.3, T7.5, T8.3, T11.6 |
| NFR-SCL-01 | T8.3, T9.4, T7.8 |
| NFR-SEC-01..04 | T2.2, T2.6, T7.7, T7.11, T9.13, T11.1, T12.6 |
| NFR-DAT-01..02 | T5.2, T5.3, T5.6, T5.8, T12.2 |
| NFR-OBS-01..02 | T3.2, T3.5, T8.5, T11.3 |
| NFR-MNT-01..03 | T0.3, T1.3, T11.7, T13.3 |
| NFR-TST-01..02 | T1.6, T12.7 and the test tasks in each phase |
| NFR-DEP-01..02 | T2.1–T2.6, T4.4–T4.7, T11.6, T13.5 |
| NFR-CMP-01 | T3.7, T5.5, T8.1 |
| NFR-USA-01..03 | T5.7–T5.11, T10.4, T11.4, T11.5 |

---

## 22. Implementation notes (version 0.3)

The system was built from this specification. These are the places where the code intentionally differs from version 0.2, and why. The full list with task references is in `docs/implementation-plan.md` → "Implementation status".

| Area | Spec 0.2 | As built | Reason |
|---|---|---|---|
| Data access | Prisma | node-postgres + SQL migrations run at boot | See TD-05 and ADR 0002 |
| Gateway rate limiting | `@nestjs/throttler` | `@fastify/rate-limit` with buckets (`imports` 10/min, `orders` 30/min, `payments` 30/min, default 300/min) | Proxied routes never reach Nest guards |
| Health checks | `@nestjs/terminus` | `InfraModule` controller: DB ping, broker connection, outbox backlog < 1000 | Same contract, fewer dependencies |
| `Location` headers | Service builds the public URL | Service returns `/v1/...`; the proxy rewrites it to `/api/v1/...` | `@fastify/http-proxy` already rewrites `Location` |
| Reservations | — | `stock_reservations.correlation_id` | Expiry events from the sweeper keep the original correlation id |
| Payments | `simulated_outcome` only | Plus `failures_remaining` on `payment_methods` | Makes the `FAIL_ONCE` card durable across retries |
| Orders | — | `order_lines.position`, `orders.correlation_id` | Stable line order; saga events carry the request's correlation id |
| Dockerfiles | One per service | `docker/service.Dockerfile` with `ARG SERVICE` | Identical build steps |
| Example data oracle | 18 categories; Home & Office = 14 | 17 categories; Home & Office = 13 | `Misc` and DL-007 only appear on rejected rows; corrected after the integration test disagreed |
| Smart search | — | Client-side deterministic parser (prices, categories, stock, intent → filters) shown as removable chips | "AI look and feel" that runs offline and is honest about what it does |
| OpenAPI (§10.6) | `/docs` per service + aggregated `/api/docs` | One document generated from the zod contracts (`buildOpenApiDocument`), served by the gateway with Swagger UI at `/api/docs` | The contracts already describe every public route; one source avoids aggregation |
| Tracing (§15.4) | Optional OTel + Jaeger | `@stockroom/platform/tracing` (HTTP, undici, pg); trace context persisted in `outbox.trace_context` (migration 002); manual PRODUCER/CONSUMER spans with W3C headers in AMQP | Auto-instrumenting amqplib would start new traces at relay time; storing the context keeps one trace per purchase |
| Accessibility | WCAG AA | `--subtle` and light-theme status colours darkened after axe findings; enforced by Playwright + axe in both themes | Contrast was 3.1–4.2:1 on small text |

Measured results: images 190–193 MB (web 51 MB); cold start from empty volumes 29 s; initial JS 233 KB gzipped; memory per Node service about 45–65 MB.

