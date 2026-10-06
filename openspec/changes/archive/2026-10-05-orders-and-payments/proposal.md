## Why

"Purchase products (payment provider not necessary, fake the payment)" with a UI. A purchase touches stock, orders and payments. It must never oversell, never charge twice, and always end in a clear state the shopper can see.

## What Changes

- Catalog reserves stock atomically per order, commits it on confirmation, releases it on cancellation, and expires stale reservations.
- Orders service: idempotent order placement, server-side totals, price-change detection, and an orchestrated saga with an explicit state machine.
- Payments service: card tokenization and deterministic fake outcomes, including a transient failure and refunds.
- Shop UI: cart, checkout with test cards, and a live order tracker.

## Capabilities

### New Capabilities

- `stock-inventory`: reservation, commit, release and expiry of stock.
- `order-checkout`: order placement, idempotency, states, cancellation reasons and queries.
- `payments`: tokenization, simulated charge outcomes and refunds.

### Modified Capabilities

None.

## Impact

- Services: catalog (inventory), orders (new), payments (new), gateway (routes), web. Bounded contexts: Inventory, Ordering, Payments.
- API: `POST /payments/methods`, `POST/GET /orders`, `GET /orders/{id}`, internal `GET /internal/v1/products/snapshot`.
- Database: `stock_reservations`; `orders`, `order_lines`, `order_status_history`; `payment_methods`, `payments`.

## Non-goals

- Real payment providers, shipping, taxes, user accounts.

## Open questions / assumptions

- Zero-total orders skip payment. Reservations expire after 10 minutes. A payment that succeeds after cancellation is refunded (ADR 0004, ADR 0011).
