import { join } from 'node:path';
import multipart from '@fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpApp, createFastifyAdapter, runMigrations } from '@stockroom/platform';
import { AppModule } from '../../src/app.module';
import { catalogConfigSchema } from '../../src/config';
import { startCatalogPostgres } from '../support/postgres';

const EXAMPLE = join(__dirname, '..', '..', 'seed', 'example.csv');
const PROBLEM = 'application/problem+json';

describe('catalog HTTP API', () => {
  let container: StartedPostgreSqlContainer;
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const postgres = await startCatalogPostgres();
    container = postgres.container;
    await runMigrations(postgres.url, join(__dirname, '..', '..', 'migrations'));
    const config = catalogConfigSchema.parse({
      DATABASE_URL: postgres.url,
      AMQP_URL: 'amqp://unused:unused@127.0.0.1:1',
      SEED_ON_START: 'false',
      LOG_LEVEL: 'silent',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { bufferLogs: true });
    await configureHttpApp(app, {
      configure: async (instance) => {
        await instance.register(multipart, { limits: { fileSize: config.IMPORT_MAX_BYTES, files: 1 } });
      },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  describe('imports', () => {
    it('imports the example CSV and reports the expected counters', async () => {
      const response = await http().post('/v1/imports').attach('file', EXAMPLE, 'Code Challenge E-Commerce.csv');
      expect(response.status).toBe(201);
      expect(response.headers.location).toBe(`/v1/imports/${response.body.id}`);
      expect(response.body).toMatchObject({
        status: 'COMPLETED_WITH_ERRORS',
        totals: { totalLines: 97, blankLines: 2, processedRows: 95, created: 87, rejected: 5, warnings: 3 },
      });
      const issues = await http().get(`/v1/imports/${response.body.id}/issues?severity=ERROR`);
      expect(issues.body.page.totalItems).toBe(5);
      const csv = await http().get(`/v1/imports/${response.body.id}/issues?format=csv`);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('attachment');
      expect(csv.text).toContain("16,DL-007,stock,'-5,NEGATIVE_STOCK");
    });

    it('rejects a CSV with missing columns with 422 and the job id', async () => {
      const response = await http().post('/v1/imports').attach('file', Buffer.from('name,sku\nA,B-1\n'), 'bad.csv');
      expect(response.status).toBe(422);
      expect(response.headers['content-type']).toContain(PROBLEM);
      expect(response.body).toMatchObject({ code: 'CSV_INVALID_HEADER', missing: expect.arrayContaining(['price', 'stock']) });
      const job = await http().get(`/v1/imports/${response.body.jobId}`);
      expect(job.body.status).toBe('FAILED');
    });

    it('rejects non-CSV files and requests without a file', async () => {
      const wrong = await http().post('/v1/imports').attach('file', Buffer.from('x'), 'data.xlsx');
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('UNSUPPORTED_FILE');
      const empty = await http().post('/v1/imports').send({});
      expect(empty.status).toBe(400);
    });

    it('lists the import history newest first', async () => {
      const response = await http().get('/v1/imports?pageSize=5');
      expect(response.status).toBe(200);
      expect(response.body.data[0].status).toBe('FAILED');
      expect(response.body.page.totalItems).toBeGreaterThanOrEqual(2);
    });
  });

  describe('products', () => {
    it('lists, searches and filters with pagination metadata', async () => {
      const all = await http().get('/v1/products?pageSize=5');
      expect(all.status).toBe(200);
      expect(all.body.page).toEqual({ page: 1, pageSize: 5, totalItems: 87, totalPages: 18 });
      expect(all.body.match).toBeNull();
      const twoTypos = await http().get('/v1/products?q=wirless%20speakr');
      expect(twoTypos.body.match).toBe('partial');
      expect(twoTypos.body.data.length).toBeGreaterThan(0);
      const typo = await http().get('/v1/products?q=bluetoth');
      expect(typo.body.match).toBe('all');
      expect(typo.body.data.map((item: { sku: string }) => item.sku)).toEqual(expect.arrayContaining(['BS-021', 'BS-099']));
      const filtered = await http().get('/v1/products?category=home-and-office&category=kitchen&maxPriceCents=2000&inStock=true&pageSize=100');
      expect(filtered.body.data.every((item: { price: { amountCents: number } }) => item.price.amountCents <= 2000)).toBe(true);
    });

    it('validates query parameters', async () => {
      const sort = await http().get('/v1/products?sort=random&pageSize=500');
      expect(sort.status).toBe(400);
      expect(sort.headers['content-type']).toContain(PROBLEM);
      expect(sort.body.errors.map((error: { path: string }) => error.path)).toEqual(expect.arrayContaining(['sort', 'pageSize']));
      const range = await http().get('/v1/products?minPriceCents=500&maxPriceCents=100');
      expect(range.status).toBe(400);
      expect(range.body.errors).toEqual([{ path: 'minPriceCents', message: 'minPriceCents must be less than or equal to maxPriceCents' }]);
    });

    it('runs the full create → read → update → delete lifecycle with optimistic concurrency', async () => {
      const created = await http()
        .post('/v1/products')
        .set('x-request-id', 'http-test-1')
        .send({ sku: 'http-1', name: 'HTTP Lamp', category: 'Home & Office', priceCents: 1999, stock: 4, weightGrams: 900 });
      expect(created.status).toBe(201);
      expect(created.headers['x-request-id']).toBe('http-test-1');
      expect(created.headers.etag).toBe('"1"');
      expect(created.headers.location).toBe(`/v1/products/${created.body.id}`);
      expect(created.body).toMatchObject({ sku: 'HTTP-1', category: { slug: 'home-and-office' }, available: 4 });

      const id = created.body.id as string;
      const fetched = await http().get(`/v1/products/${id}`);
      expect(fetched.headers.etag).toBe('"1"');

      const body = { name: 'HTTP Lamp 2', category: 'Home & Office', priceCents: 2499, stock: 4, weightGrams: 900 };
      expect((await http().put(`/v1/products/${id}`).send(body)).status).toBe(428);
      const updated = await http().put(`/v1/products/${id}`).set('if-match', '"1"').send(body);
      expect(updated.status).toBe(200);
      expect(updated.headers.etag).toBe('"2"');
      const stale = await http().put(`/v1/products/${id}`).set('if-match', '"1"').send(body);
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });

      expect((await http().delete(`/v1/products/${id}`)).status).toBe(204);
      expect((await http().get(`/v1/products/${id}`)).status).toBe(404);
      expect((await http().delete(`/v1/products/${id}`)).status).toBe(404);
    });

    it('rejects duplicates, invalid bodies, unknown fields and malformed ids', async () => {
      const duplicate = await http().post('/v1/products').send({ sku: 'RS-001', name: 'Dup', category: 'Footwear', priceCents: 1, stock: 1 });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toMatchObject({ code: 'DUPLICATE_SKU', sku: 'RS-001' });
      const invalid = await http().post('/v1/products').send({ sku: '', name: '  ', category: '', priceCents: -1, stock: 1.5, extra: true });
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors.length).toBeGreaterThanOrEqual(4);
      const malformed = await http().post('/v1/products').set('content-type', 'application/json').send('{bad');
      expect(malformed.status).toBe(400);
      expect(malformed.headers['content-type']).toContain(PROBLEM);
      expect((await http().get('/v1/products/not-a-uuid')).status).toBe(400);
      expect((await http().get('/v1/products/0190a3c2-7d1e-7b2a-9c4f-1f2e3d4c5b6a')).body.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('stores hostile text literally', async () => {
      const response = await http().get('/v1/products?q=DROP%20TABLE');
      expect(response.body.data.map((item: { name: string }) => item.name)).toContain("Robert'); DROP TABLE products;--");
    });

    it('lists categories with counts', async () => {
      const response = await http().get('/v1/categories');
      expect(response.status).toBe(200);
      expect(response.body.data.find((category: { slug: string }) => category.slug === 'electronics')).toMatchObject({ productCount: 16 });
    });
  });

  describe('internal snapshot', () => {
    it('returns price and availability for the orders service', async () => {
      const list = await http().get('/v1/products?q=RS-001');
      const id = list.body.data[0].id as string;
      const response = await http().get(`/internal/v1/products/snapshot?ids=${id}`);
      expect(response.body.data).toEqual([{ id, sku: 'RS-001', name: 'Running Shoes', priceCents: 9499, currency: 'USD', available: 120, active: true }]);
      expect((await http().get('/internal/v1/products/snapshot?ids=x')).status).toBe(400);
    });
  });

  describe('health', () => {
    it('reports liveness and readiness details', async () => {
      expect((await http().get('/health/live')).body).toEqual({ status: 'ok' });
      const ready = await http().get('/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.checks).toMatchObject({ database: true, broker: false });
    });
  });
});
