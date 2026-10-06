## 1. Catalog service

- [x] 1.1 Migration: categories and products with constraints and indexes
- [x] 1.2 Product repository (pg) and category resolution
- [x] 1.3 Use cases: create, get, list, update with version check, soft delete, categories
- [x] 1.4 Controllers with ETag, Location and If-Match handling
- [x] 1.5 Integration tests: duplicate SKU, version conflict, missing If-Match, delete with reservations
- [x] 1.6 HTTP tests: full lifecycle and problem responses

## 2. Web (Studio)

- [x] 2.1 Products table with search, category filter and pagination
- [x] 2.2 Create/edit form with live preview and server error mapping
- [x] 2.3 Version conflict dialog that reloads the latest version and keeps edits
- [x] 2.4 Delete confirmation dialog
- [x] 2.5 Playwright: create, edit, delete and two-tab conflict

## 3. Verification

- [x] 3.1 Verify: CRUD works end to end in the UI and through the smoke script
