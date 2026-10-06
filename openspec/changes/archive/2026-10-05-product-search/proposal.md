## Why

"Search for Products" with a UI is a core requirement. Shoppers type imperfect queries such as typos, partial SKUs and prices in words, so search must be forgiving, relevant and filterable.

## What Changes

- Full-text search over name, SKU and description with relevance ranking, typo tolerance and SKU prefix matching.
- Filters for category, price range and availability; whitelisted sorting; pagination.
- A smart search box in the UI that turns phrases like "electronics under $30 in stock" into visible, removable filters.

## Capabilities

### New Capabilities

- `product-search`: query semantics, filters, sorting and ranking guarantees.

### Modified Capabilities

None.

## Impact

- Services: catalog. Bounded context: Catalog. API: `GET /products` query parameters.
- Database: generated `search_vector` column, GIN and trigram indexes.
- Web: Discover page, smart search, command palette.

## Non-goals

- A dedicated search engine (ADR 0006); LLM-based query understanding (must run offline).

## Open questions / assumptions

- Expected catalog size is thousands of products, not millions.
