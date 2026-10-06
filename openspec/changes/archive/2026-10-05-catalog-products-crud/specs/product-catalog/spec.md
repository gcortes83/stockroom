## Purpose

Lets admins manage the product catalog safely and lets anyone read it, with exact prices and protection against lost updates.

## ADDED Requirements

### Requirement: Create products

The system SHALL create a product from `sku`, `name`, `category`, `priceCents` and `stock`, plus an optional `description` and `weightGrams`. It responds `201` with the product, a `Location` header and `ETag: "1"`.

#### Scenario: Valid product is created
- **WHEN** an admin posts `{ sku: "nb-200", name: "Dotted Notebook", category: "Stationery", priceCents: 650, stock: 300 }`
- **THEN** the system responds `201` with SKU `NB-200`, version 1 and `available` equal to the stock

#### Scenario: Duplicate SKU
- **WHEN** an admin creates a product with an SKU that already exists
- **THEN** the system responds `409` with code `DUPLICATE_SKU`

#### Scenario: Invalid fields
- **WHEN** the name is empty or whitespace, the price is negative, the stock is not a whole number, or an unknown field is sent
- **THEN** the system responds `400` with code `VALIDATION` and one error per invalid field

### Requirement: Exact money and units

Prices MUST be handled as integer minor units and returned as `{ amountCents, currency }`; weights MUST be integer grams or null.

#### Scenario: Price round-trips exactly
- **WHEN** a product is saved with price 19.99
- **THEN** it is stored and returned as `amountCents: 1999` without rounding drift

### Requirement: Read products

The system SHALL return a product by id with an `ETag` holding its version, and exclude deleted products.

#### Scenario: Unknown product
- **WHEN** a client requests a product id that does not exist or was deleted
- **THEN** the system responds `404` with code `PRODUCT_NOT_FOUND`

#### Scenario: Malformed id
- **WHEN** a client requests `/products/not-a-uuid`
- **THEN** the system responds `400`

### Requirement: Optimistic concurrency on updates

Updates MUST require `If-Match` with the current version and SHALL increment the version on success. The SKU MUST NOT be changeable.

#### Scenario: Missing precondition
- **WHEN** an admin updates a product without `If-Match`
- **THEN** the system responds `428` with code `PRECONDITION_REQUIRED`

#### Scenario: Stale version
- **WHEN** two admins edit version 1 and the second one saves after the first
- **THEN** the second save responds `409` with code `VERSION_CONFLICT` and `currentVersion: 2`

#### Scenario: Stock below reserved units
- **WHEN** an admin sets stock lower than the units reserved by open orders
- **THEN** the system responds `409` with code `STOCK_BELOW_RESERVED`

### Requirement: Soft delete

Deleting a product SHALL hide it from reads, lists and search while keeping it for order history. Deletion MUST be refused while units are reserved.

#### Scenario: Product deleted
- **WHEN** an admin deletes a product with no reservations
- **THEN** the system responds `204` and later reads respond `404`

#### Scenario: Product with active reservations
- **WHEN** an admin deletes a product with reserved units
- **THEN** the system responds `409` with code `PRODUCT_HAS_ACTIVE_RESERVATIONS`

### Requirement: Categories

Categories SHALL be created on first use, matched case-insensitively, and exposed with slugs and product counts through `GET /categories`.

#### Scenario: Ampersand category
- **WHEN** a product uses category `Home & Office`
- **THEN** the category is listed with slug `home-and-office`
