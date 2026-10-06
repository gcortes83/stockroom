import { Inject, Injectable } from '@nestjs/common';
import type { ImportIssue, ImportJob, ImportStatus, ImportTotals, IssueSeverity } from '@stockroom/contracts';
import { DATABASE, type Database, iso, isoRequired, newId, type Queryable } from '@stockroom/platform';

type JobRow = {
  id: string;
  filename: string;
  source: 'UPLOAD' | 'SEED';
  status: ImportStatus;
  total_lines: number;
  blank_lines: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  rejected_count: number;
  warning_count: number;
  failure_message: string | null;
  started_at: Date;
  finished_at: Date | null;
};

const toJob = (row: JobRow): ImportJob => ({
  id: row.id,
  filename: row.filename,
  source: row.source,
  status: row.status,
  totals: {
    totalLines: row.total_lines,
    blankLines: row.blank_lines,
    processedRows: row.processed_rows,
    created: row.created_count,
    updated: row.updated_count,
    unchanged: row.unchanged_count,
    rejected: row.rejected_count,
    warnings: row.warning_count,
  },
  failureMessage: row.failure_message,
  startedAt: isoRequired(row.started_at),
  finishedAt: iso(row.finished_at),
});

export type ExistingProduct = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category_id: string;
  price_cents: number;
  stock: number;
  reserved: number;
  weight_grams: number | null;
  deleted: boolean;
};

export type ProductUpsert = {
  id: string;
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  stock: number;
  weightGrams: number | null;
};

@Injectable()
export class ImportRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async createJob(filename: string, source: 'UPLOAD' | 'SEED'): Promise<string> {
    const id = newId();
    await this.db.query(
      `INSERT INTO import_jobs (id, filename, status, source, started_at) VALUES ($1, $2, 'PROCESSING', $3, now())`,
      [id, filename.slice(0, 255), source],
    );
    return id;
  }

  async finishJob(id: string, status: ImportStatus, totals: ImportTotals, sizeBytes: number, failure: string | null): Promise<void> {
    await this.db.query(
      `UPDATE import_jobs SET status = $2, total_lines = $3, blank_lines = $4, processed_rows = $5, created_count = $6,
         updated_count = $7, unchanged_count = $8, rejected_count = $9, warning_count = $10, size_bytes = $11,
         failure_message = $12, finished_at = now()
       WHERE id = $1`,
      [
        id,
        status,
        totals.totalLines,
        totals.blankLines,
        totals.processedRows,
        totals.created,
        totals.updated,
        totals.unchanged,
        totals.rejected,
        totals.warnings,
        sizeBytes,
        failure,
      ],
    );
  }

  async insertIssues(jobId: string, issues: readonly ImportIssue[], tx: Queryable = this.db): Promise<void> {
    if (issues.length === 0) return;
    await tx.query(
      `INSERT INTO import_row_issues (id, job_id, line, sku, field, value, code, message, severity)
       SELECT unnest($1::uuid[]), $2, unnest($3::int[]), unnest($4::text[]), unnest($5::text[]), unnest($6::text[]),
              unnest($7::text[]), unnest($8::text[]), unnest($9::issue_severity[])`,
      [
        issues.map(() => newId()),
        jobId,
        issues.map((issue) => issue.line),
        issues.map((issue) => issue.sku),
        issues.map((issue) => issue.field),
        issues.map((issue) => (issue.value === null ? null : issue.value.slice(0, 500))),
        issues.map((issue) => issue.code),
        issues.map((issue) => issue.message),
        issues.map((issue) => issue.severity),
      ],
    );
  }

  async lockExisting(tx: Queryable, skus: string[]): Promise<Map<string, ExistingProduct>> {
    const { rows } = await tx.query<ExistingProduct>(
      `SELECT id, sku, name, description, category_id, price_cents, stock, reserved, weight_grams,
              deleted_at IS NOT NULL AS deleted
       FROM products WHERE sku = ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [skus],
    );
    return new Map(rows.map((row) => [row.sku, row]));
  }

  async insertProducts(tx: Queryable, rows: readonly ProductUpsert[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.query(
      `INSERT INTO products (id, sku, name, description, category_id, price_cents, stock, weight_grams)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::uuid[], $6::bigint[], $7::int[], $8::int[])`,
      [
        rows.map((row) => row.id),
        rows.map((row) => row.sku),
        rows.map((row) => row.name),
        rows.map((row) => row.description),
        rows.map((row) => row.categoryId),
        rows.map((row) => row.priceCents),
        rows.map((row) => row.stock),
        rows.map((row) => row.weightGrams),
      ],
    );
  }

  async updateProducts(tx: Queryable, rows: readonly ProductUpsert[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.query(
      `UPDATE products p SET name = v.name, description = v.description, category_id = v.category_id,
         price_cents = v.price_cents, stock = v.stock, weight_grams = v.weight_grams, deleted_at = NULL,
         version = p.version + 1, updated_at = now()
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[], $5::bigint[], $6::int[], $7::int[])
         AS v(id, name, description, category_id, price_cents, stock, weight_grams)
       WHERE p.id = v.id`,
      [
        rows.map((row) => row.id),
        rows.map((row) => row.name),
        rows.map((row) => row.description),
        rows.map((row) => row.categoryId),
        rows.map((row) => row.priceCents),
        rows.map((row) => row.stock),
        rows.map((row) => row.weightGrams),
      ],
    );
  }

  async getJob(id: string): Promise<ImportJob | null> {
    const { rows } = await this.db.query<JobRow>('SELECT * FROM import_jobs WHERE id = $1', [id]);
    return rows[0] ? toJob(rows[0]) : null;
  }

  async listJobs(page: number, pageSize: number): Promise<{ items: ImportJob[]; total: number }> {
    const { rows } = await this.db.query<JobRow & { total_items: number }>(
      'SELECT *, count(*) OVER () AS total_items FROM import_jobs ORDER BY started_at DESC, id DESC LIMIT $1 OFFSET $2',
      [pageSize, (page - 1) * pageSize],
    );
    return { items: rows.map(toJob), total: rows[0]?.total_items ?? 0 };
  }

  async listIssues(
    jobId: string,
    severity: IssueSeverity | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ items: ImportIssue[]; total: number }> {
    const { rows } = await this.db.query<ImportIssue & { total_items: number }>(
      `SELECT line, sku, field, value, code, message, severity, count(*) OVER () AS total_items
       FROM import_row_issues WHERE job_id = $1 AND ($2::issue_severity IS NULL OR severity = $2)
       ORDER BY line, severity, id LIMIT $3 OFFSET $4`,
      [jobId, severity ?? null, pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map(({ total_items: _total, ...issue }) => issue),
      total: rows[0]?.total_items ?? 0,
    };
  }

  async allIssues(jobId: string): Promise<ImportIssue[]> {
    const { rows } = await this.db.query<ImportIssue>(
      'SELECT line, sku, field, value, code, message, severity FROM import_row_issues WHERE job_id = $1 ORDER BY line, severity, id',
      [jobId],
    );
    return rows;
  }

  async hasSeedJob(): Promise<boolean> {
    const { rows } = await this.db.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM import_jobs WHERE source = 'SEED' AND status <> 'FAILED') AS exists",
    );
    return rows[0]?.exists ?? false;
  }

  async productCount(): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>('SELECT count(*)::int AS count FROM products');
    return rows[0]?.count ?? 0;
  }
}
