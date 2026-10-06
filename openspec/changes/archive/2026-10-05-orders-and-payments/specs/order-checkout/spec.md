## Purpose

Lets shoppers buy products with a clear, trackable outcome, without duplicate orders or charges, and always with prices computed by the server.

## ADDED Requirements

### Requirement: Place orders idempotently

`POST /orders` MUST require an `Idempotency-Key` UUID and SHALL respond `202` with the order in `PENDING` and a `Location` header. Repeating the request with the same key and body MUST return the same order with `Idempotent-Replayed: true`.

#### Scenario: Missing key
- **WHEN** an order is posted without `Idempotency-Key`
- **THEN** the system responds `428` with code `IDEMPOTENCY_KEY_REQUIRED`

#### Scenario: Double submit
- **WHEN** the same order is posted twice, or concurrently, with the same key
- **THEN** exactly one order exists

#### Scenario: Key reused with a different body
- **WHEN** a key is reused with different lines
- **THEN** the system responds `422` with code `IDEMPOTENCY_KEY_REUSED`

### Requirement: Server-side pricing

Totals MUST be computed by the server from current catalog prices in integer cents. When `expectedTotalCents` differs from the computed total, the order MUST be rejected.

#### Scenario: Price changed since the cart was built
- **WHEN** the expected total does not match
- **THEN** the system responds `409` with code `PRICE_CHANGED`, the current unit prices and the new total

#### Scenario: Not enough stock up front
- **WHEN** a line requests more units than are available
- **THEN** the system responds `409` with code `INSUFFICIENT_STOCK` and the shortages

#### Scenario: Unknown product
- **WHEN** a line references a missing or deleted product
- **THEN** the system responds `409` with code `PRODUCT_UNAVAILABLE`

#### Scenario: Catalog unavailable
- **WHEN** prices cannot be fetched
- **THEN** the system responds `503` with code `CATALOG_UNAVAILABLE`

### Requirement: Order lifecycle

Orders SHALL move through `PENDING → AWAITING_PAYMENT → CONFIRMED` or end in `CANCELLED` with a reason (`OUT_OF_STOCK`, `PAYMENT_DECLINED`, `RESERVATION_EXPIRED`, `STOCK_COMMIT_FAILED`). Every transition MUST be recorded in the order history. Illegal transitions MUST be ignored.

#### Scenario: Approved payment
- **WHEN** stock is reserved and the payment succeeds
- **THEN** the order is `CONFIRMED` with history `PENDING → AWAITING_PAYMENT → CONFIRMED`

#### Scenario: Declined payment
- **WHEN** the payment fails
- **THEN** the order is `CANCELLED` with reason `PAYMENT_DECLINED` and its stock is released

#### Scenario: Free order
- **WHEN** the order total is 0
- **THEN** the order is confirmed after reservation without a payment

#### Scenario: Late payment
- **WHEN** a payment succeeds for an order that was already cancelled
- **THEN** a refund is requested

### Requirement: Order queries

The system SHALL return an order with its lines, totals, payment summary, cancellation reason and history, and list orders newest first with an optional status filter.

#### Scenario: Unknown order
- **WHEN** a client requests an order id that does not exist
- **THEN** the system responds `404` with code `ORDER_NOT_FOUND`

### Requirement: Shopper checkout experience

The shop SHALL keep a cart on the device and offer checkout with fill-in buttons for the test cards. It SHALL prevent double submission and show live progress (order received, reserving stock, processing payment, final state), with a human-readable reason when the order is cancelled.

#### Scenario: Shopper sees confirmation
- **WHEN** a shopper pays with card 4242 4242 4242 4242
- **THEN** the tracker reaches "Order confirmed" and the cart is cleared

#### Scenario: Shopper sees the decline reason
- **WHEN** a shopper pays with card 4000 0000 0000 0002
- **THEN** the tracker shows "Order cancelled" with "The card was declined by the issuer."
