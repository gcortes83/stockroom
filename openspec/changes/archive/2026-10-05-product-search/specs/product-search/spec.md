## Purpose

Lets shoppers and admins find products with imperfect queries and narrow the results with filters, with results always consistent with the catalog.

## ADDED Requirements

### Requirement: Free-text search

`GET /products?q=` SHALL match the name, SKU and description, rank name and SKU matches above description-only matches, and treat any input (including markup or SQL-like text) as plain text.

#### Scenario: Typo tolerance
- **WHEN** a client searches for `bluetoth`
- **THEN** the results include the Bluetooth speakers

#### Scenario: Exact SKU ranks first
- **WHEN** a client searches for `rs-001`
- **THEN** the product with SKU `RS-001` is the first result

#### Scenario: SKU prefix
- **WHEN** a client searches for `RS-0`
- **THEN** products whose SKU starts with `RS-0` are returned

#### Scenario: Hostile input
- **WHEN** a client searches for `'; DROP TABLE products;--` or `<script>`
- **THEN** the system responds `200` with matching products and no side effects

### Requirement: Filters

The listing SHALL support category slugs (repeatable), `minPriceCents`, `maxPriceCents` and `inStock`, combined with AND semantics.

#### Scenario: In stock only
- **WHEN** a client filters with `inStock=true`
- **THEN** no returned product has zero available units

#### Scenario: Inverted price range
- **WHEN** `minPriceCents` is greater than `maxPriceCents`
- **THEN** the system responds `400` with an error on `minPriceCents`

### Requirement: Sorting

The listing SHALL accept `sort` values `relevance`, `price_asc`, `price_desc`, `name_asc` and `newest`, defaulting to `relevance` with a query and `newest` without one. Other values MUST be rejected with `400`.

#### Scenario: Unknown sort
- **WHEN** a client sends `sort=random`
- **THEN** the system responds `400` with an error on `sort`

### Requirement: Smart search in the UI

The Discover page SHALL interpret phrases for price bounds ("under $30", "between 10 and 40"), availability ("in stock"), sort intent ("cheap", "newest") and category names, show each interpretation as a removable chip, and keep the full query in the URL.

#### Scenario: Phrase becomes filters
- **WHEN** a shopper types `cheap electronics under $30 in stock`
- **THEN** chips for "Up to $30", "In stock", "Lowest price first" and "Electronics" are shown and the results respect them

#### Scenario: Removing a chip edits the query
- **WHEN** the shopper removes the "Electronics" chip
- **THEN** the query text no longer contains that word and the category filter is cleared
