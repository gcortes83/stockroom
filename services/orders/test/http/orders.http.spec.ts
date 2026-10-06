import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductSnapshot } from '@stockroom/contracts';
import { configureHttpApp, createFastifyAdapter, newId, runMigrations } from '@stockroom/platform';
import { AppModule } from '../../src/app.module';
import { ordersConfigSchema } from '../../src/config';
import { CATALOG_PORT, type CatalogPort } from '../../src/infrastructure/catalog.client';

const productId = '0190a3c2-7d1e-7b2a-9c4f-1f2e3d4c5b6a';
const PROBLEM = 'application/problem+json';

class FakeCatalog implements CatalogPort {
  available = 5;
  async snapshot(ids: string[]): Promise<ProductSnapshot[]> {
    return ids.includes(productId)
      ? [{ id: productId, sku: 'RS-001', name: 'Running Shoes', priceCents: 9499, currency: 'USD', available: this.available, active: true }]
      : [];
  }
}

describe('orders HTTP API', () => {
  let container: StartedPostgreSqlContainer;
  let app: NestFastifyApplication;
  const catalog = new FakeCatalog();
  const http = () => request(app.getHttpServer());
  const body = (quantity = 2, extra: Record<string, unknown> = {}) => ({
    customer: { name: 'Ada', email: 'ADA@example.com' },
    lines: [{ productId, quantity }],
    paymentMethodId: 'pm_abcdefghijklmnopqrstuvwx',
    ...extra,
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    await runMigrations(container.getConnectionUri(), join(__dirname, '..', '..', 'migrations'));
    const config = ordersConfigSchema.parse({
      DATABASE_URL: container.getConnectionUri(),
      AMQP_URL: 'amqp://unused:unused@127.0.0.1:1',
      LOG_LEVEL: 'silent',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(CATALOG_PORT)
      .useValue(catalog)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { bufferLogs: true });
    await configureHttpApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('requires a UUID Idempotency-Key', async () => {
    const missing = await http().post('/v1/orders').send(body());
    expect(missing.status).toBe(428);
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const invalid = await http().post('/v1/orders').set('idempotency-key', 'abc').send(body());
    expect(invalid.status).toBe(400);
    expect(invalid.headers['content-type']).toContain(PROBLEM);
  });

  it('accepts an order with 202, Location and server-side totals', async () => {
    const response = await http().post('/v1/orders').set('idempotency-key', newId()).set('x-request-id', 'order-trace').send(body());
    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(`/v1/orders/${response.body.id}`);
    expect(response.headers['x-request-id']).toBe('order-trace');
    expect(response.body).toMatchObject({
      status: 'PENDING',
      customer: { email: 'ada@example.com' },
      total: { amountCents: 18998, currency: 'USD' },
      lines: [{ sku: 'RS-001', quantity: 2, unitPrice: { amountCents: 9499 } }],
      history: [{ from: null, to: 'PENDING' }],
    });
    const fetched = await http().get(`/v1/orders/${response.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(response.body.id);
  });

  it('replays the same key and rejects a reused key with a different body', async () => {
    const key = newId();
    const first = await http().post('/v1/orders').set('idempotency-key', key).send(body());
    const replay = await http().post('/v1/orders').set('idempotency-key', key).send(body());
    expect(replay.status).toBe(202);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    const reused = await http().post('/v1/orders').set('idempotency-key', key).send(body(1));
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('returns 409 with details for price changes, stock shortages and unknown products', async () => {
    const changed = await http().post('/v1/orders').set('idempotency-key', newId()).send(body(2, { expectedTotalCents: 100 }));
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ code: 'PRICE_CHANGED', totalCents: 18998, lines: [{ productId, unitPriceCents: 9499 }] });
    const short = await http().post('/v1/orders').set('idempotency-key', newId()).send(body(9));
    expect(short.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', lines: [{ sku: 'RS-001', requested: 9, available: 5 }] });
    const unknown = await http()
      .post('/v1/orders')
      .set('idempotency-key', newId())
      .send({ ...body(), lines: [{ productId: newId(), quantity: 1 }] });
    expect(unknown.body.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('validates the body with field paths', async () => {
    const response = await http()
      .post('/v1/orders')
      .set('idempotency-key', newId())
      .send({ customer: { name: '', email: 'nope' }, lines: [], paymentMethodId: 'x' });
    expect(response.status).toBe(400);
    expect(response.body.errors.map((error: { path: string }) => error.path)).toEqual(
      expect.arrayContaining(['customer.name', 'customer.email', 'lines', 'paymentMethodId']),
    );
  });

  it('lists orders with status filters and pagination', async () => {
    const all = await http().get('/v1/orders?pageSize=2');
    expect(all.status).toBe(200);
    expect(all.body.page.pageSize).toBe(2);
    expect(all.body.data[0]).toMatchObject({ status: 'PENDING', customerEmail: 'ada@example.com', lineCount: 1 });
    const confirmed = await http().get('/v1/orders?status=CONFIRMED');
    expect(confirmed.body.data).toEqual([]);
    expect((await http().get('/v1/orders?status=NOPE')).status).toBe(400);
  });

  it('answers 404 problem for unknown orders and 400 for malformed ids', async () => {
    const missing = await http().get(`/v1/orders/${newId()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('ORDER_NOT_FOUND');
    expect((await http().get('/v1/orders/123')).status).toBe(400);
  });
});
