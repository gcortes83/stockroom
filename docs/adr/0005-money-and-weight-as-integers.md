# 0005. Money as integer cents, weight as integer grams

- Status: accepted
- Date: 2026-10-05

## Context

The CSV contains prices such as `$29.99` and `1,299.00`; floating point would introduce rounding errors.

## Decision

Prices are parsed with string arithmetic (`parseMoney`) into integer cents and stored as `BIGINT`. Weights become integer grams. Totals are computed server-side; the UI only formats.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| NUMERIC everywhere | Exact in the database | JavaScript still needs a decimal type for arithmetic |
| Floats | Simple | Rounding errors; unacceptable for money |

## Consequences

Exact arithmetic everywhere with property-based tests. Single currency (USD).
