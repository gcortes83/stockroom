# web-studio Specification

## Purpose
Defines the admin ("Studio") area used to operate the store: managing products, imports and orders.

## Requirements

### Requirement: Studio area

The Studio SHALL group products, imports and orders under `/admin`, and MUST display a banner stating that no authentication is enforced in this build.

#### Scenario: Banner is visible
- **WHEN** a user opens any Studio page
- **THEN** the "no authentication" banner is shown

### Requirement: Orders monitoring

The Studio SHALL list orders newest first with a status filter, refresh automatically, and show each order's lines, payment summary, cancellation reason and step-by-step saga progress.

#### Scenario: Filter by status
- **WHEN** an admin selects "Cancelled"
- **THEN** only cancelled orders are listed

#### Scenario: Inspect an order
- **WHEN** an admin opens an order
- **THEN** its status history is shown with timestamps and reasons
