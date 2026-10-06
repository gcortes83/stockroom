# 0004. Orchestrated checkout saga in orders; inventory stays in catalog

- Status: accepted
- Date: 2026-10-05

## Context

A purchase must reserve stock, charge a (fake) card and confirm or compensate, across three services, without overselling.

## Decision

The orders service orchestrates with an explicit state machine (`PENDING → AWAITING_PAYMENT → CONFIRMED | CANCELLED`), implemented as a pure `decide(state, signal)` function. Catalog owns stock and reservations (`reserved` counter + `stock_reservations`), with TTL expiry. Late payments after cancellation trigger refunds; commits after expiry re-check stock.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Choreography | No central coordinator | Flow is spread across services and harder to reason about and test |
| Separate inventory service | Purer boundaries | Creates a distributed stock-ownership problem between catalog and inventory |
| Synchronous 2PC | Strong consistency | Not supported by the stack, couples availability of all services |

## Consequences

The whole flow is testable as a table of state × event. Checkout is eventually consistent; the UI polls the order status.
