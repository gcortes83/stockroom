## Context

The search query (`ProductRepository.search`) combines four phrase-level conditions: full-text match, `<%` word similarity on the name, SKU prefix and name substring. See proposal.md for the failure.

## Goals / Non-Goals

**Goals:** typo tolerance per word, no zero-result dead ends, no regression for exact searches or performance.
**Non-Goals:** a different search engine (ADR 0006 stays valid).

## Decisions

- **Tokens**: the query is split on whitespace into at most 6 tokens of 2 or more characters. A token matches a product when the full-text vector matches it, or its word similarity to the name passes the threshold, or the name contains it, or the SKU starts with it.
- **Two-step evaluation**:
  - *Strict*: a product matches when the existing phrase conditions match **or** every token matches.
  - *Partial fallback*: if strict returns no rows and the query has more than one token, the query runs again with "any token matches".
  - The response carries `match: "all"` or `"partial"`. The second query runs only on empty strict results, so the common path costs nothing extra.
- **Whole-phrase fuzzy matching only for single-word queries**: for two or more words, `phrase <% name` passes whenever one word matches strongly ("bluetoth leah" vs "Bluetooth Speaker"), which would report a full match when only one word matched. Exact phrase, SKU-prefix and substring conditions still apply to the whole query.
- **Ranking**: the existing score plus the sum of per-token word similarities, so partial results matching more words (or matching better) rank first.
- **Threshold**: `pg_trgm.word_similarity_threshold = 0.5`, set as a session setting on every catalog connection (`createDatabase(..., sessionSettings)`), so the `<%` operator keeps using the trigram GIN index. A migration with `ALTER DATABASE ... SET` was tried first and failed in production because the catalog role is not a superuser. The catalog test harnesses now use a non-superuser owner, like production, so this class of problem fails in tests.

### Alternatives considered

| Option | Trade-off |
|---|---|
| Always OR across words | Never empty, but exact searches like "walnut lamp" would return every walnut and every lamp |
| Explicit `word_similarity(t, name) >= 0.5` | Clear, but bypasses the GIN index (sequential scan) |
| Lower the threshold to 0.4 | More recall, but noisy matches on short words |

## Risks / Trade-offs

- [More conditions per query] → each token condition is index-backed; the benchmark is re-run to confirm p95 stays under target.
