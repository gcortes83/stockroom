import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { productListQuerySchema } from '@stockroom/contracts';
import { type Harness, startHarness } from './harness';

const EXAMPLE = join(__dirname, '..', '..', 'seed', 'example.csv');
const FILENAME = 'Code Challenge E-Commerce.csv';
const csv = (text: string) => Readable.from([Buffer.from(text)]);

describe('CSV import against PostgreSQL', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h?.stop());
  beforeEach(async () => h.reset());

  it('imports the example file with the exact expected counters', async () => {
    const job = await h.importer.importCsv(createReadStream(EXAMPLE), FILENAME);
    expect(job.status).toBe('COMPLETED_WITH_ERRORS');
    expect(job.totals).toEqual({
      totalLines: 97,
      blankLines: 2,
      processedRows: 95,
      created: 87,
      updated: 0,
      unchanged: 0,
      rejected: 5,
      warnings: 3,
    });
    const issues = await h.imports.allIssues(job.id);
    const errors = issues.filter((issue) => issue.severity === 'ERROR').map((issue) => [issue.line, issue.sku, issue.code]);
    expect(errors).toEqual([
      [7, 'YM-015', 'INVALID_PRICE'],
      [16, 'DL-007', 'NEGATIVE_STOCK'],
      [25, 'HD-099', 'NAME_REQUIRED'],
      [41, 'WS-001', 'NAME_REQUIRED'],
      [52, 'GC-025', 'CATEGORY_REQUIRED'],
    ]);
    const warnings = issues.filter((issue) => issue.severity === 'WARNING').map((issue) => [issue.line, issue.sku]);
    expect(warnings).toEqual([
      [36, 'RS-001'],
      [56, 'BS-021'],
      [89, 'BS-021'],
    ]);
    const categories = await h.products.listCategories();
    expect(categories).toHaveLength(17);
  });

  it('applies last-wins for duplicate SKUs and keeps hostile text literally', async () => {
    await h.importer.importCsv(createReadStream(EXAMPLE), FILENAME);
    const search = async (q: string) => (await h.products.search(productListQuerySchema.parse({ q }))).items;
    const [runningShoes] = await search('RS-001');
    expect(runningShoes).toMatchObject({ sku: 'RS-001', price: { amountCents: 9499 }, stock: 120 });
    const speaker = (await search('BS-021')).find((product) => product.sku === 'BS-021');
    expect(speaker).toMatchObject({ price: { amountCents: 5999 }, stock: 110 });
    const sql = (await search('DROP TABLE')).find((product) => product.sku === 'SQL-001');
    expect(sql?.name).toBe("Robert'); DROP TABLE products;--");
    const xss = (await search('script')).find((product) => product.sku === 'XS-001');
    expect(xss?.name).toBe("<script>alert('xss')</script>");
    const { rows } = await h.db.query<{ count: number }>('SELECT count(*)::int AS count FROM products');
    expect(rows[0]?.count).toBe(87);
  });

  it('is idempotent when the same file is imported again', async () => {
    await h.importer.importCsv(createReadStream(EXAMPLE), FILENAME);
    const second = await h.importer.importCsv(createReadStream(EXAMPLE), FILENAME);
    expect(second.totals).toMatchObject({ created: 0, updated: 0, unchanged: 87, rejected: 5, warnings: 3 });
  });

  it('rejects a file with a missing header column without writing products', async () => {
    await expect(h.importer.importCsv(csv('name,sku,price\nA,B-1,1.00\n'), 'bad.csv')).rejects.toMatchObject({
      code: 'CSV_INVALID_HEADER',
      status: 422,
    });
    const { rows } = await h.db.query<{ count: number }>('SELECT count(*)::int AS count FROM products');
    expect(rows[0]?.count).toBe(0);
    const { rows: jobs } = await h.db.query<{ status: string }>('SELECT status FROM import_jobs');
    expect(jobs.map((job) => job.status)).toEqual(['FAILED']);
  });

  it('accepts reordered, differently cased headers with a BOM', async () => {
    const text = '﻿SKU,Name,Price,Stock,Category,Description,Weight KG\r\nab-1,Thing,1.50,3,Misc,desc,0.1\r\n';
    const job = await h.importer.importCsv(csv(text), 'ok.csv');
    expect(job.totals).toMatchObject({ created: 1, rejected: 0 });
  });

  it('rejects non .csv files', async () => {
    await expect(h.importer.importCsv(csv('x'), 'data.xlsx')).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
  });
});

describe('search relevance', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    await h.importer.importCsv(createReadStream(EXAMPLE), FILENAME);
  });
  afterAll(async () => h?.stop());

  const search = async (params: Record<string, unknown>) =>
    h.products.search(productListQuerySchema.parse(params));

  it('ranks an exact SKU match first', async () => {
    const { items } = await search({ q: 'rs-001' });
    expect(items[0]?.sku).toBe('RS-001');
  });

  it('tolerates typos', async () => {
    const { items } = await search({ q: 'bluetoth' });
    expect(items.map((item) => item.sku)).toEqual(expect.arrayContaining(['BS-021', 'BS-099']));
  });

  it('matches SKU prefixes', async () => {
    const { items } = await search({ q: 'RS-0' });
    expect(items.map((item) => item.sku)).toEqual(expect.arrayContaining(['RS-001', 'RS-050']));
  });

  it('filters by category slug containing an ampersand', async () => {
    const { total } = await search({ category: 'home-and-office', pageSize: '100' });
    expect(total).toBe(13);
  });

  it('filters by price range and stock', async () => {
    const { items } = await search({ maxPriceCents: '1000', inStock: 'true', pageSize: '100' });
    expect(items.every((item) => item.price.amountCents <= 1000 && item.available > 0)).toBe(true);
    expect(items.some((item) => item.sku === 'VC-001')).toBe(false);
  });

  it('falls back to partial matches when no product matches every misspelled word', async () => {
    const result = await search({ q: 'wirless speakr', pageSize: '20' });
    expect(result.match).toBe('partial');
    const skus = result.items.map((item) => item.sku);
    expect(skus).toEqual(expect.arrayContaining(['BS-021', 'BS-099', 'SS-022', 'WM-042', 'WE-023']));
    expect(skus.indexOf('BS-021')).toBeLessThan(skus.indexOf('WM-042'));
  });

  it('does not report a full match when only one misspelled word matches strongly', async () => {
    const result = await search({ q: 'bluetoth leah', pageSize: '20' });
    expect(result.match).toBe('partial');
    expect(result.items.map((item) => item.sku)).toEqual(expect.arrayContaining(['BS-021', 'BS-099', 'DL-045']));
  });

  it('keeps exact multi-word searches precise', async () => {
    const result = await search({ q: 'running shoes' });
    expect(result.match).toBe('all');
    expect(result.items.map((item) => item.sku).sort()).toEqual(['RS-001', 'RS-050']);
  });

  it('returns no match flag without a query and stays safe with hostile multi-word input', async () => {
    expect((await search({})).match).toBeNull();
    const hostile = await search({ q: "'; DROP TABLE products;-- <script>alert(1)</script>" });
    expect(hostile.match).not.toBeUndefined();
    const { rows } = await h.db.query<{ count: number }>('SELECT count(*)::int AS count FROM products');
    expect(rows[0]?.count).toBe(87);
  });

  it('matches every misspelled word when a product has them all, ranking it first', async () => {
    const created = await h.productsService.create({
      sku: 'TYPO-1',
      name: 'Wireless Bluetooth Speaker',
      description: 'Portable',
      category: 'Electronics',
      priceCents: 4999,
      stock: 5,
      weightGrams: null,
    });
    const result = await search({ q: 'wirless speakr' });
    expect(result.match).toBe('all');
    expect(result.items[0]?.sku).toBe('TYPO-1');
    expect(result.items.map((item) => item.sku)).not.toContain('WM-042');
    await h.productsService.delete(created.id);
  });

  it('returns an empty page beyond the end with the real total', async () => {
    const result = await search({ page: '99' });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(87);
  });
});
