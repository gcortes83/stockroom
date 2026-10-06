## Purpose

Keeps stock correct while purchases are in progress, so the store never sells more units than it has and abandoned checkouts do not lock stock forever.

## ADDED Requirements

### Requirement: Atomic all-or-nothing reservation

For each new order the system SHALL reserve all lines or none. A product's available units (`stock − reserved`) MUST never become negative.

#### Scenario: Concurrent purchases of the last unit
- **WHEN** 20 orders for the only remaining unit are processed at the same time
- **THEN** exactly one reservation succeeds and the others fail with the shortage details

#### Scenario: One line unavailable
- **WHEN** an order has two lines and one product lacks stock
- **THEN** nothing is reserved and a reservation failure lists the product with requested and available units

### Requirement: Commit and release

Confirmed orders SHALL turn their reservations into stock decrements; cancelled orders SHALL release them. Both operations MUST be idempotent.

#### Scenario: Confirmation decrements stock
- **WHEN** an order reserving one unit of a product with stock 1 is confirmed
- **THEN** stock becomes 0 and reserved becomes 0

#### Scenario: Cancellation restores availability
- **WHEN** an order is cancelled after its stock was reserved
- **THEN** the reserved units become available again

### Requirement: Reservation expiry

Reservations not committed within the TTL (10 minutes by default) SHALL be released automatically and reported per order.

#### Scenario: Abandoned checkout
- **WHEN** a reservation is older than the TTL
- **THEN** its units are released and the order is notified of the expiry

#### Scenario: Confirmation arrives after expiry
- **WHEN** a payment confirms an order whose reservation expired and the stock was sold meanwhile
- **THEN** the commit fails and the order is notified so it can be cancelled and refunded
