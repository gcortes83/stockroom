## 1. Catalog

- [x] 1.1 Word similarity threshold 0.5 as a catalog session setting (and non-superuser test harness)
- [x] 1.2 Tokenized strict query with partial-match fallback and per-token ranking
- [x] 1.3 Integration tests: two typos (partial), all words with typos (all), exact multi-word unchanged, hostile multi-word input
- [x] 1.4 HTTP test: `match` field in the response

## 2. Contracts and web

- [x] 2.1 Optional `match` field in the list response schema and OpenAPI
- [x] 2.2 Discover hint for partial matches
- [x] 2.3 Playwright: partial-match hint with two unique products; `runing shoez` finds Running Shoes without the hint

## 3. Verification

- [x] 3.1 Re-run the search benchmark (p95 < 300 ms, text shapes index-backed, typo shape returns results)
- [x] 3.2 Update the manual and README search examples
