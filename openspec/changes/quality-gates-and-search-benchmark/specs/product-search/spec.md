## ADDED Requirements

### Requirement: Search performance

With a catalog of 10,000 products, `GET /products` searches and filtered listings SHALL respond with a p95 latency below 300 ms under 50 concurrent clients on the reference machine, and every query shape MUST use an index rather than a sequential scan.

#### Scenario: Benchmark meets the target
- **WHEN** the search benchmark runs 50 concurrent clients for 30 seconds against a 10,000-product catalog
- **THEN** the measured p95 latency is below 300 ms

#### Scenario: Index usage
- **WHEN** the query plan for a keyword search is analyzed
- **THEN** it uses the full-text or trigram index instead of a sequential scan on products
