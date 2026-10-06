---
name: api-design
description: REST API and contract design for Stockroom — resource naming, endpoints for products/search/import/orders/payments, pagination, filtering, problem+json errors, idempotency, optimistic concurrency, versioning and OpenAPI. Use when defining or changing any HTTP endpoint or shared contract in packages/contracts.
---

# API Design

## Principles
- Contract-first: define zod schemas in `packages/contracts` → generate OpenAPI → implement. Frontend and services import the same schemas.
- Public surface is the gateway under `/api/v1`. Service-internal routes are not exposed to the browser.
- JSON camelCase on the wire. UTC ISO-8601 timestamps. Money as `{ amountCents: number, currency: "USD" }`.

## Endpoints (authoritative detail in docs/technical-specification.md §10)
```
GET    /api/v1/products?q=&category=&minPriceCents=&maxPriceCents=&inStock=&sort=&page=&pageSize=
GET    /api/v1/products/:id
POST   /api/v1/products                       201 + Location
PUT    /api/v1/products/:id     If-Match: "<version>"   200 | 409 VERSION_CONFLICT | 428 if missing
DELETE /api/v1/products/:id                           204 (soft delete) | 409 if active reservations
GET    /api/v1/categories
POST   /api/v1/imports       multipart/form-data      201 + ImportJob (synchronous; same shape if it becomes async)
GET    /api/v1/imports                                paginated job history
GET    /api/v1/imports/:id                            status + counters
GET    /api/v1/imports/:id/issues                     paginated row issues (+ ?format=csv)
POST   /api/v1/payments/methods                       201 + { id: pm_…, brand, last4 } (card tokenization)
POST   /api/v1/orders           Idempotency-Key        202 + Order (status PENDING)
GET    /api/v1/orders/:id                              status, lines, totals, failureReason
GET    /api/v1/orders?page=
```
Search lives on `GET /products` with `q` — one listing endpoint, not a separate `/search` resource (document if changed).

## Pagination
- Response: `{ data: T[], page: { page, pageSize, totalItems, totalPages } }`. `pageSize` max 100, default 20.
- Sort: `sort=price:asc,name:asc` whitelist only.

## Errors
- RFC 9457 `application/problem+json` (see backend-nestjs). Validation errors list `errors[{ path, message }]`.
- Never return 200 with an error body.

## Idempotency
- `Idempotency-Key` (UUID) required on `POST /orders`. Same key + same body → replay stored response; same key + different body → 422.

## Concurrency
- `ETag: "<version>"` on product GET; `If-Match` required on update → 428 `PRECONDITION_REQUIRED` if missing, 409 `VERSION_CONFLICT` (with `currentVersion`) if stale.

## Versioning
- URI major version (`/v1`). Additive changes only within a version. Event contracts versioned separately (`.v1`).

## OpenAPI
- Each service exposes `/docs`; gateway aggregates at `/api/docs`. Keep examples realistic (from the CSV).

## Review checklist
- [ ] Schema in contracts, used by both sides
- [ ] Correct status codes and problem types
- [ ] Pagination/sort whitelisted, limits enforced
- [ ] Idempotency / concurrency semantics stated
- [ ] Documented in OpenAPI with examples
