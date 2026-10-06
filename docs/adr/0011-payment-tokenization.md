# 0011. Card tokenization in the payments service

- Status: accepted
- Date: 2026-10-05

## Context

Card data must not travel through orders, events or logs, even in a fake provider.

## Decision

The browser posts card details to `POST /payments/methods`, which validates Luhn and expiry, stores only brand and last 4 digits plus a simulated outcome, and returns a `pm_…` token. Orders and events only carry the token.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Card number in the order request | Fewer calls | Card data in orders, events and logs |
| Outcome by amount only | Simpler | Cannot demonstrate declines and transient errors |

## Consequences

Realistic flow with deterministic test cards; logs redact card fields.
