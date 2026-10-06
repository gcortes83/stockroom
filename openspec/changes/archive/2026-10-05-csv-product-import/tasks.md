## 1. Catalog service

- [x] 1.1 Row normalization and validation rules with unit tests for every case in the data profile
- [x] 1.2 Streaming parser with header validation and limits
- [x] 1.3 Import job and issue tables
- [x] 1.4 Batch upsert with created / updated / unchanged / conflict classification
- [x] 1.5 Endpoints: upload, job, history, issues (JSON and CSV)
- [x] 1.6 First-start seeding of the example file
- [x] 1.7 Integration oracle: 97 lines, 2 blank, 95 processed, 87 created, 5 rejected, 3 warnings; re-import 87 unchanged
- [x] 1.8 HTTP tests: multipart upload, 422 header, unsupported file, CSV export escaping

## 2. Web (Studio)

- [x] 2.1 Dropzone with client-side checks and upload progress
- [x] 2.2 Import history and data-quality report with an issue table and CSV download
- [x] 2.3 Playwright: upload, report, bad header, seeded import

## 3. Documentation

- [x] 3.1 README: CSV source, download date and handling table
