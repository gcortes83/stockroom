## Context

Depends on `reliable-messaging`. Decisions are recorded in ADR 0004 (saga) and ADR 0011 (tokenization).

## Goals / Non-Goals

**Goals:** no overselling, no duplicate orders or charges, every order reaches CONFIRMED or CANCELLED.
**Non-Goals:** partial fulfilment of multi-line orders.

## Decisions

- **Reservation**: lock product rows in id order, then `UPDATE … SET reserved = reserved + n WHERE stock - reserved >= n`. If any line fails, roll back to a savepoint and emit `reservation-failed` with the shortages. All-or-nothing.
- **Commit after expiry**: re-check availability; if stock is gone, emit `commit-failed` so orders cancels and refunds.
- **Sweeper** every 30 s under an advisory lock releases expired reservations and emits `reservation-expired` per order.
- **Order placement**: `Idempotency-Key` (UUID) plus the SHA-256 of the canonical body. The same key and body replays the order (`Idempotent-Replayed: true`); the same key with a different body gets 422. Concurrent duplicates are resolved by a unique constraint and a re-read.
- **Price snapshot** from the catalog's internal API with timeout, retry and a circuit breaker; failure gives 503. `expectedTotalCents` detects price changes (409 `PRICE_CHANGED`).
- **Saga**: pure `decide(state, signal) → effects`, applied in one transaction with history rows and outbox events. States: `PENDING → AWAITING_PAYMENT → CONFIRMED | CANCELLED`.
- **Payments**: the card is tokenized first (Luhn, expiry, brand, last 4 digits only). Charges are idempotent per order; `FAIL_ONCE` cards throw a transient error once so the retry path is exercised.
- **UI**: the cart is saved on the device; checkout reuses the payment method and idempotency key while inputs are unchanged; the tracker polls every 1 s, backs off to 3 s, and stops at a terminal state or after 60 s.

### Alternatives considered

| Option | Trade-off |
|---|---|
| Choreography | No coordinator, but the flow is scattered and hard to test |
| Decrement stock at order time | Simple, but stock is lost when payments fail without compensation |
| Card data in orders | Fewer calls, but card numbers would travel through events and logs |

## Risks / Trade-offs

- [Eventual consistency: the order is PENDING briefly] → the UI shows each step; the expected end-to-end time is under 3 s.
