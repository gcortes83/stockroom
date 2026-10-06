## Purpose

Defines the contract every public HTTP endpoint follows: one entry point, consistent errors, request correlation, pagination and abuse protection.

## ADDED Requirements

### Requirement: Single public entry point

The system SHALL expose its public API only under `/api/v1` through the gateway, and MUST NOT expose service-internal endpoints to clients.

#### Scenario: Public route is proxied to its service
- **WHEN** a client calls `GET /api/v1/products`
- **THEN** the gateway forwards the request to the catalog service and returns its response

#### Scenario: Internal endpoint is not reachable
- **WHEN** a client calls `GET /internal/v1/products/snapshot`
- **THEN** the system responds `404` with a problem+json body with code `NOT_FOUND`

### Requirement: Problem details for every error

Every error response MUST use `application/problem+json` (RFC 9457) with `type`, `title`, `status`, `detail`, `instance`, a stable machine-readable `code` and the request's `correlationId`.

#### Scenario: Validation error lists fields
- **WHEN** a request body fails validation
- **THEN** the system responds `400` with code `VALIDATION` and an `errors` array of `{ path, message }`

#### Scenario: Malformed JSON body
- **WHEN** a request sends `content-type: application/json` with an unparsable body
- **THEN** the system responds `400` with a problem+json body

#### Scenario: Unexpected failure hides internals
- **WHEN** an unhandled error occurs
- **THEN** the system responds `500` with code `INTERNAL` and no stack trace

#### Scenario: Upstream service is down
- **WHEN** the gateway cannot reach the owning service
- **THEN** it responds `502` with code `UPSTREAM_UNAVAILABLE` and the service name, or `504` with code `UPSTREAM_TIMEOUT` on timeout

### Requirement: Request correlation

The system SHALL accept a safe `x-request-id` header or generate one, return it on every response, and propagate it to downstream services and logs.

#### Scenario: Client-provided id is echoed
- **WHEN** a client sends `x-request-id: trace-123`
- **THEN** the response carries `x-request-id: trace-123` and the upstream service receives the same id

#### Scenario: Unsafe id is replaced
- **WHEN** a client sends an `x-request-id` with spaces or more than 128 characters
- **THEN** the system generates a new id and returns it

### Requirement: Paginated collections

Collection endpoints SHALL return `{ data, page: { page, pageSize, totalItems, totalPages } }`, accept `page` (≥ 1, default 1) and `pageSize` (1 to 100, default 20), and reject values outside those ranges with `400`.

#### Scenario: Page beyond the end
- **WHEN** a client requests a page after the last one
- **THEN** the system responds `200` with an empty `data` array and the real `totalItems`

### Requirement: Rate limiting

The gateway MUST limit requests per client IP: 10 per minute for CSV imports, 30 per minute for order placement and card tokenization, and 300 per minute for everything else.

#### Scenario: Limit exceeded
- **WHEN** a client exceeds its bucket
- **THEN** the gateway responds `429` with code `RATE_LIMITED` and a `Retry-After` header
