## 1. Catalog (inventory)

- [x] 1.1 Reservations table and reserve / commit / release / expire use cases
- [x] 1.2 Inventory consumer and expiry sweeper
- [x] 1.3 Internal snapshot endpoint
- [x] 1.4 Integration: 20 concurrent orders for the last unit reserve exactly one

## 2. Orders

- [x] 2.1 Orders schema, aggregate and state machine with a unit test per state × signal
- [x] 2.2 PlaceOrder with idempotency, price snapshot, circuit breaker and price-change check
- [x] 2.3 Saga service and consumer
- [x] 2.4 Integration tests: idempotency under concurrency, happy path, decline, late payment refund
- [x] 2.5 HTTP tests: 202 / 409 / 422 / 428 and listing

## 3. Payments

- [x] 3.1 Tokenization endpoint and simulated outcomes
- [x] 3.2 Charge and refund consumers, idempotent per order
- [x] 3.3 Unit and HTTP tests, including that card numbers are never stored

## 4. Web

- [x] 4.1 Cart saved on the device with quantity caps
- [x] 4.2 Checkout with test cards and server error mapping
- [x] 4.3 Order tracker with animated steps and cancellation reasons
- [x] 4.4 Playwright: approved, declined and sold-out purchases

## 5. Verification

- [x] 5.1 Smoke: decline releases stock, approval decrements it, a retried card confirms, idempotent replay works
