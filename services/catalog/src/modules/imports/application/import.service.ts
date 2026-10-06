import { Inject, Injectable, Logger } from '@nestjs/common';
import { pipeline, type Readable, Transform } from 'node:stream';
import { parse } from 'csv-parse';
import type { ImportIssue, ImportJob, ImportStatus, ImportTotals } from '@stockroom/contracts';
import { DATABASE, type Database, newId } from '@stockroom/platform';
import { CATALOG_CONFIG, type CatalogConfig } from '../../../config';
import { ProductRepository } from '../../products/infrastructure/product.repository';
import {
  dedupeBySku,
  isBlankRow,
  missingColumns,
  normalizeHeader,
  type RawRow,
  validateRow,
  type ValidRow,
} from '../domain/csv-rules';
import { csvInvalidHeader, importNotFound, tooManyRows, unsupportedFile } from '../domain/errors';
import { type ExistingProduct, ImportRepository, type ProductUpsert } from '../infrastructure/import.repository';

export type ParsedFile = {
  header: string[] | null;
  totalLines: number;
  blankLines: number;
  rejectedRows: number;
  validRows: ValidRow[];
  issues: ImportIssue[];
  bytes: number;
};

type CsvRecord = { record: RawRow; info: { lines: number; invalid_field_length: number } };

const emptyTotals = (): ImportTotals => ({
  totalLines: 0,
  blankLines: 0,
  processedRows: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  rejected: 0,
  warnings: 0,
});

function isUnchanged(existing: ExistingProduct, next: ProductUpsert): boolean {
  return (
    !existing.deleted &&
    existing.name === next.name &&
    existing.description === next.description &&
    existing.category_id === next.categoryId &&
    existing.price_cents === next.priceCents &&
    existing.stock === next.stock &&
    existing.weight_grams === next.weightGrams
  );
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger('ImportService');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ImportRepository) private readonly imports: ImportRepository,
    @Inject(ProductRepository) private readonly products: ProductRepository,
    @Inject(CATALOG_CONFIG) private readonly config: CatalogConfig,
  ) {}

  async importCsv(source: Readable, filename: string, origin: 'UPLOAD' | 'SEED' = 'UPLOAD'): Promise<ImportJob> {
    if (!/\.csv$/i.test(filename)) {
      source.resume();
      throw unsupportedFile('Only .csv files are supported');
    }
    const jobId = await this.imports.createJob(filename, origin);
    const totals = emptyTotals();
    let bytes = 0;
    try {
      const parsed = await this.parse(source);
      bytes = parsed.bytes;
      totals.totalLines = parsed.totalLines;
      totals.blankLines = parsed.blankLines;
      totals.processedRows = parsed.totalLines - parsed.blankLines;
      const missing = missingColumns(parsed.header);
      if (missing.length > 0) {
        const error = csvInvalidHeader(missing, jobId);
        await this.imports.finishJob(jobId, 'FAILED', totals, bytes, error.message);
        throw error;
      }
      const { rows, warnings } = dedupeBySku(parsed.validRows);
      const conflicts = await this.persist(rows, totals);
      const issues = [...parsed.issues, ...warnings, ...conflicts].sort((a, b) => a.line - b.line);
      await this.imports.insertIssues(jobId, issues);
      totals.rejected = parsed.rejectedRows + conflicts.length;
      totals.warnings = warnings.length;
      const status: ImportStatus = totals.rejected > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
      await this.imports.finishJob(jobId, status, totals, bytes, null);
      this.logger.log({ jobId, ...totals }, `Import ${filename} finished with status ${status}`);
    } catch (error) {
      const job = await this.imports.getJob(jobId);
      if (job?.status === 'PROCESSING') {
        await this.imports.finishJob(jobId, 'FAILED', totals, bytes, (error as Error).message.slice(0, 1000));
      }
      throw error;
    }
    const job = await this.imports.getJob(jobId);
    if (!job) throw importNotFound(jobId);
    return job;
  }

  async parse(source: Readable): Promise<ParsedFile> {
    let header: string[] | null = null;
    let bytes = 0;
    let firstChunk = true;
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (firstChunk) {
          firstChunk = false;
          if (chunk.includes(0)) {
            callback(unsupportedFile('The file is not a UTF-8 text CSV'));
            return;
          }
        }
        callback(null, chunk);
      },
    });
    const parser = parse({
      columns: (columns: string[]) => {
        header = columns.map(normalizeHeader);
        return header;
      },
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      info: true,
      max_record_size: 20_000,
    });
    pipeline(source, guard, parser, (error) => {
      if (error) parser.destroy(error);
    });

    const result: ParsedFile = { header: null, totalLines: 0, blankLines: 0, rejectedRows: 0, validRows: [], issues: [], bytes: 0 };
    for await (const entry of parser as AsyncIterable<CsvRecord>) {
      result.totalLines++;
      if (result.totalLines > this.config.IMPORT_MAX_ROWS) {
        source.destroy();
        throw tooManyRows(this.config.IMPORT_MAX_ROWS);
      }
      const line = entry.info.lines;
      if (isBlankRow(entry.record)) {
        result.blankLines++;
        continue;
      }
      if (entry.info.invalid_field_length > 0) {
        result.rejectedRows++;
        result.issues.push({
          line,
          sku: null,
          field: null,
          value: null,
          code: 'CSV_MALFORMED_ROW',
          message: 'The row does not have the same number of columns as the header',
          severity: 'ERROR',
        });
        continue;
      }
      const validation = validateRow(entry.record, line);
      if (validation.ok) result.validRows.push(validation.row);
      else {
        result.rejectedRows++;
        result.issues.push(...validation.issues);
      }
    }
    result.header = header;
    result.bytes = bytes;
    return result;
  }

  private async persist(rows: readonly ValidRow[], totals: ImportTotals): Promise<ImportIssue[]> {
    const conflicts: ImportIssue[] = [];
    const batchSize = this.config.IMPORT_BATCH_SIZE;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const outcome = await this.db.transaction(async (tx) => {
        const categories = await this.products.ensureCategories(tx, batch.map((row) => row.category));
        const existing = await this.imports.lockExisting(tx, batch.map((row) => row.sku));
        const inserts: ProductUpsert[] = [];
        const updates: ProductUpsert[] = [];
        const batchConflicts: ImportIssue[] = [];
        let unchanged = 0;
        for (const row of batch) {
          const categoryId = categories.get(row.category.toLowerCase());
          if (!categoryId) throw new Error(`Category ${row.category} could not be resolved`);
          const current = existing.get(row.sku);
          const upsert: ProductUpsert = {
            id: current?.id ?? newId(),
            sku: row.sku,
            name: row.name,
            description: row.description,
            categoryId,
            priceCents: row.priceCents,
            stock: row.stock,
            weightGrams: row.weightGrams,
          };
          if (!current) inserts.push(upsert);
          else if (row.stock < current.reserved)
            batchConflicts.push({
              line: row.line,
              sku: row.sku,
              field: 'stock',
              value: String(row.stock),
              code: 'STOCK_BELOW_RESERVED',
              message: `Stock cannot be lower than the ${current.reserved} units reserved by open orders`,
              severity: 'ERROR',
            });
          else if (isUnchanged(current, upsert)) unchanged++;
          else updates.push(upsert);
        }
        await this.imports.insertProducts(tx, inserts);
        await this.imports.updateProducts(tx, updates);
        return { created: inserts.length, updated: updates.length, unchanged, conflicts: batchConflicts };
      });
      totals.created += outcome.created;
      totals.updated += outcome.updated;
      totals.unchanged += outcome.unchanged;
      conflicts.push(...outcome.conflicts);
    }
    return conflicts;
  }
}
