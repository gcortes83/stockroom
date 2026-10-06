# Example CSV — Data Profile

- File: `Code Challenge E-Commerce.csv`
- Downloaded: **2026-10-05** (file timestamp 15:48 local; confirm before submission)
- Encoding: UTF-8, no BOM, contains non-ASCII (`—`, `™`)
- Line endings: CRLF, no trailing newline
- Header: `name,sku,description,category,price,stock,weight_kg`
- 97 data lines → 2 fully blank (`,,,,,,`) → **95 meaningful rows**
- 18 distinct categories + 3 rows with empty category (2 of them blank lines)

## Findings

| Line | SKU | Issue | Proposed handling |
|---|---|---|---|
| 4 | WM-042 | price `$29.99` (currency symbol) | Normalize: strip leading `$`, accept |
| 7 | YM-015 | price `free` | Reject: non-numeric, do not guess 0 |
| 16 | DL-007 | stock `-5` | Reject: negative stock |
| 20 | XS-001 | name `<script>alert('xss')</script>` | Accept as literal text; safe by output encoding (React) + test proving no execution |
| 25 | HD-099 | empty name | Reject: name required |
| 29 | SQL-001 | name `Robert'); DROP TABLE products;--` | Accept as literal text; safe by parameterized queries + test |
| 31 | WB-033 | `—`, `™` in description | Accept; UTF-8 end to end |
| 36 | RS-001 | duplicate SKU in file, updated description/price | Last occurrence wins; warning reported |
| 41 | WS-001 | whitespace-only name | Reject after trim |
| 47 | MB-001 | price `0.00` | Accept (free product is valid) |
| 50 | GK-088 | empty `weight_kg` | Accept with `weight = null` (weight optional) |
| 51 | VC-001 | stock `0` | Accept; shown as out of stock, not purchasable |
| 52 | GC-025 | empty category, stock `99999`, weight `0` | Reject: category required |
| 53 | CI-001 | quoted comma in name | CSV parser (RFC 4180) |
| 55 | RS-050 | name duplicates RS-001 with different SKU | Valid: SKU is the identity, names are not unique |
| 56 | BS-021 | duplicate SKU, different description/price | Last occurrence wins; warning |
| 59 | QI-001 | escaped quotes `""Inside""` | CSV parser (RFC 4180) |
| 62–63 | — | fully blank rows | Skip silently, not counted as errors |
| 89 | BS-021 | exact duplicate of line 11 (third occurrence) | Last occurrence wins → final BS-021 equals line 11 data |
| 98 | PRJ-001 | no trailing newline | CSV parser |

Other observations: `PC-001` has a `;` inside an unquoted field (fine with `,` delimiter); `Food & Beverage` / `Home & Office` contain `&` (URL-encode in filters); weights like `35.0` and `0` must parse as decimals.

## Expected import result with proposed defaults
- Rows processed: 95 (2 blank skipped)
- Rejected: 5 (YM-015, DL-007, HD-099, WS-001, GC-025)
- Accepted rows: 90 → **87 distinct products** (RS-001 ×2, BS-021 ×3 collapse)
- Warnings: 3 duplicate-SKU overrides

These numbers become assertions in the catalog integration test.

## Decisions to confirm
1. `$29.99`: normalize (proposed) or reject?
2. Empty category: reject (proposed) or map to `Uncategorized`?
3. Empty weight: accept as null (proposed) or reject?
4. Script/SQL-looking names: accept as literal text (proposed) or reject names containing markup?
5. In-file duplicate SKUs: last wins with warning (proposed) or reject all duplicates?
6. Re-import of SKUs already in the DB: upsert (proposed) or reject?
7. Categories: dynamic table created from data (proposed; 18 names in the file, 17 created because `Misc` only appears on a rejected row) or fixed enum?
