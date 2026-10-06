import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpApp, createDatabase, createFastifyAdapter, runMigrations } from '@stockroom/platform';
import { AppModule } from '../../src/app.module';
import { paymentsConfigSchema } from '../../src/config';

const card = (overrides: Record<string, unknown> = {}) => ({
  cardNumber: '4242 4242 4242 4242',
  expMonth: 12,
  expYear: 2030,
  cvc: '123',
  holderName: 'Ada Lovelace',
  ...overrides,
});

describe('payments HTTP API', () => {
  let container: StartedPostgreSqlContainer;
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    await runMigrations(container.getConnectionUri(), join(__dirname, '..', '..', 'migrations'));
    const config = paymentsConfigSchema.parse({
      DATABASE_URL: container.getConnectionUri(),
      AMQP_URL: 'amqp://unused:unused@127.0.0.1:1',
      LOG_LEVEL: 'silent',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { bufferLogs: true });
    await configureHttpApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('tokenizes a card and returns only non-sensitive fields', async () => {
    const response = await http().post('/v1/payments/methods').send(card());
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.stringMatching(/^pm_[A-Za-z0-9]{24}$/),
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      expiresAt: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toContain('4242424242424242');
  });

  it('never persists the full card number or the CVC', async () => {
    await http().post('/v1/payments/methods').send(card({ cardNumber: '5555555555554444', cvc: '987' }));
    const db = createDatabase(container.getConnectionUri());
    const { rows } = await db.query<{ dump: string }>(
      "SELECT (to_jsonb(payment_methods) - 'id' - 'created_at' - 'expires_at')::text AS dump FROM payment_methods",
    );
    const columns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('payment_methods', 'payments')",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(expect.arrayContaining(['cvc', 'card_number']));
    await db.close();
    const dump = rows.map((row) => row.dump).join('\n');
    expect(dump).toContain('4444');
    expect(dump).not.toContain('5555555555554444');
    expect(dump).not.toContain('987');
  });

  it('rejects invalid card numbers and expired cards with field errors', async () => {
    const luhn = await http().post('/v1/payments/methods').send(card({ cardNumber: '4242424242424241' }));
    expect(luhn.status).toBe(400);
    expect(luhn.headers['content-type']).toContain('application/problem+json');
    expect(luhn.body.errors).toEqual([{ path: 'cardNumber', message: 'Card number is invalid' }]);
    const expired = await http().post('/v1/payments/methods').send(card({ expMonth: 1, expYear: 2020 }));
    expect(expired.body.errors).toEqual([{ path: 'expMonth', message: 'Card is expired' }]);
  });

  it('validates shape before business rules', async () => {
    const response = await http().post('/v1/payments/methods').send({ cardNumber: 'abc', expMonth: 13, cvc: '1', holderName: '' });
    expect(response.status).toBe(400);
    expect(response.body.errors.map((error: { path: string }) => error.path)).toEqual(
      expect.arrayContaining(['cardNumber', 'expMonth', 'expYear', 'cvc', 'holderName']),
    );
  });
});
