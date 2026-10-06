## Why

Searching `wirless speakr` returned nothing, although single-word typos such as `bluetoth` worked. Trigram similarity was computed for the whole query, so two misspelled words scored 0.33 against "Bluetooth Speaker", far below the threshold. Shoppers type quickly on phones; a search that silently returns zero results loses sales. This was found while benchmarking search (change `quality-gates-and-search-benchmark`). It improves "Search for Products" in `requeriments.txt`.

## What Changes

- Each word of the query is matched on its own, tolerating typos.
- Results must match every word. When no product does, the system returns products matching any word, ranked by how well they match, and says so in the response (`match: "partial"`).
- The word-similarity threshold is lowered from 0.6 to 0.5 so common one-letter omissions (`wirless` → "Wireless", 0.55) match.
- For multi-word queries, fuzzy matching applies per word only. This prevents one strong word from being reported as a full match.
- Discover shows a hint when results are partial matches.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `product-search`: free-text search gains per-word typo tolerance and the partial-match fallback.

## Impact

- catalog: search query; per-connection `pg_trgm.word_similarity_threshold` session setting (platform `createDatabase` gains optional session settings).
- catalog tests: Testcontainers harnesses now use a non-superuser database owner, like production.
- contracts: product list response gains a `match` field (additive, no version bump); OpenAPI updated.
- web: partial-match hint on Discover.

## Non-goals

- Synonyms, stemming beyond the existing dictionaries, and "did you mean" suggestions.

## Open questions / assumptions

- A 0.5 threshold does not add noticeable noise. Measured on the 10,087-product catalog: `shoes` matches 3 products instead of 2, `bluetoth` still 2.
