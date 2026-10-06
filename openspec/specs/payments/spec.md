# payments Specification

## Purpose
Simulates a payment provider with deterministic, documented outcomes while making sure card data never leaves the payments service.

## Requirements

### Requirement: Card tokenization

`POST /payments/methods` SHALL validate the card (13–19 digits, Luhn checksum, expiry not in the past, 3–4 digit CVC, holder name) and return a token `pm_…` with brand, last 4 digits and expiry. The full card number and CVC MUST NOT be returned, stored or logged.

#### Scenario: Valid card
- **WHEN** a client tokenizes 4242 4242 4242 4242
- **THEN** the system responds `201` with brand `visa`, last4 `4242` and a `pm_` token

#### Scenario: Invalid checksum or expired card
- **WHEN** the number fails the Luhn check or the expiry is in the past
- **THEN** the system responds `400` with an error on `cardNumber` or `expMonth`

#### Scenario: Card data never persisted
- **WHEN** a card is tokenized
- **THEN** the payments database contains its last 4 digits but not the full number or the CVC

### Requirement: Deterministic simulated outcomes

Charges SHALL be approved, except card 4000 0000 0000 0002 (declined, `CARD_DECLINED`), card 4000 0000 0000 9995 (declined, `INSUFFICIENT_FUNDS`), any amount above $10,000 (`LIMIT_EXCEEDED`), and expired or unknown tokens (`INVALID_PAYMENT_METHOD`). Card 4000 0000 0000 0119 MUST fail transiently once and then be approved on retry.

#### Scenario: Transient processing error
- **WHEN** an order is paid with card 4000 0000 0000 0119
- **THEN** the first attempt fails, the retry succeeds, and the order is confirmed

### Requirement: Idempotent charges and refunds

At most one payment SHALL exist per order. A repeated charge request MUST return the original result, and refunds SHALL apply only to succeeded payments.

#### Scenario: Duplicate charge request
- **WHEN** a charge request for the same order is delivered twice
- **THEN** only one payment exists and the same result is reported
