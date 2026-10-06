## Context

Search runs in PostgreSQL inside the catalog service (ADR 0006).

## Goals / Non-Goals

**Goals:** relevance, typo tolerance, filters consistent with writes.
**Non-Goals:** facet counts per filter, synonyms.

## Decisions

- **Weighted generated tsvector**: name and SKU at weight A (`simple` dictionary), description at weight B (`english`). The query is `websearch_to_tsquery('simple') || websearch_to_tsquery('english')`, so "shoes" matches both stemmed and exact forms.
- **Typo tolerance** through `pg_trgm` word similarity on the name (`q <% name`); **SKU prefix** through `ILIKE` with the user's wildcards escaped.
- **Ranking**: `ts_rank_cd × 2 + word_similarity`, plus a large boost for an exact SKU match and a small boost for a substring match in the name.
- **Dynamic SQL** is built only from whitelisted fragments; all values are bound parameters.
- **Smart search** is a deterministic client-side parser. It extracts price bounds, stock intent, sort intent and category names, and shows them as chips; the remaining words become `q`.

### Alternatives considered

| Option | Trade-off |
|---|---|
| Meilisearch / Typesense | Better relevance, but an extra container and an eventually consistent index |
| ILIKE only | Simple, but no ranking and no typo tolerance |
| LLM query parsing | Natural, but needs network access and keys; breaks the local-only constraint |

## Risks / Trade-offs

- [Offset pagination degrades on huge catalogs] → acceptable at this size; keyset pagination is listed as future work.
