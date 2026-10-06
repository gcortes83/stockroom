## MODIFIED Requirements

### Requirement: Free-text search

`GET /products?q=` SHALL match the name, SKU and description, tolerate typos in each word of the query, rank name and SKU matches above description-only matches, and treat any input (including markup or SQL-like text) as plain text.

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

#### Scenario: Several words with typos
- **WHEN** a client searches for `wirless speakr` and a product named "Wireless Bluetooth Speaker" exists
- **THEN** that product is returned first and the response has `match: "all"`

#### Scenario: No product matches every word
- **WHEN** a client searches for `wirless speakr` and no product matches both words
- **THEN** products matching either word (for example "Bluetooth Speaker" and "Wireless Mouse") are returned, ranked by match quality, and the response has `match: "partial"`

#### Scenario: Exact multi-word search stays precise
- **WHEN** a client searches for `running shoes`
- **THEN** only products matching both words are returned and the response has `match: "all"`

