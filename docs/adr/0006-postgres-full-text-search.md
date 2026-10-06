# 0006. PostgreSQL full-text and trigram search

- Status: accepted
- Date: 2026-10-05

## Context

Search must be relevant, typo-tolerant and filterable for a small to medium catalog.

## Decision

A generated weighted `tsvector` (name and SKU weight A, description B) with GIN, plus `pg_trgm` word similarity on names and SKU prefix matching. Exact SKU matches are boosted.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Meilisearch / Typesense | Better relevance and facets | Extra container and an indexing pipeline with eventual consistency |
| OpenSearch | Very powerful | 1-2 GB RAM, overkill locally |

## Consequences

Results are always consistent with writes. Relevance tuning is manual; `ProductRepository.search` is the seam to swap engines.
