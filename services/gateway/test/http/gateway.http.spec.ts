import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGateway } from '../../src/app';
import { gatewayConfigSchema } from '../../src/config';

type Seen = { url: string; requestId: string | undefined };

describe('gateway over HTTP', () => {
  let upstream: FastifyInstance;
  let app: NestFastifyApplication;
  const seen: Seen[] = [];

  beforeAll(async () => {
    upstream = Fastify();
    upstream.get('/health/ready', async () => ({ status: 'ok' }));
    upstream.get('/v1/products', async (req) => {
      seen.push({ url: req.url, requestId: req.headers['x-request-id'] as string | undefined });
      return { data: [], page: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } };
    });
    upstream.post('/v1/products', async (_req, reply) => reply.status(201).header('location', '/v1/products/abc').send({ id: 'abc' }));
    upstream.get('/v1/orders', async () => ({ data: [] }));
    const address = await upstream.listen({ port: 0, host: '127.0.0.1' });
    const config = gatewayConfigSchema.parse({
      CATALOG_URL: address,
      ORDERS_URL: address,
      PAYMENTS_URL: 'http://127.0.0.1:1',
      RATE_LIMIT_PER_MINUTE: '5',
      LOG_LEVEL: 'silent',
    });
    app = await buildGateway(config);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await upstream?.close();
  });

  it('proxies public routes to the owning service and propagates the request id', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/products?q=lamp').set('x-request-id', 'trace-123');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('trace-123');
    expect(seen.at(-1)).toEqual({ url: '/v1/products?q=lamp', requestId: 'trace-123' });
  });

  it('rewrites upstream Location headers to the public prefix', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/products').send({ any: 'body' });
    expect(response.status).toBe(201);
    expect(response.headers.location).toBe('/api/v1/products/abc');
  });

  it('answers problem+json 502 when an upstream is down', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/payments/methods').send({});
    expect(response.status).toBe(502);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', service: 'payments' });
  });

  it('never exposes internal service endpoints', async () => {
    const response = await request(app.getHttpServer()).get('/internal/v1/products/snapshot?ids=x');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('serves the OpenAPI document and Swagger UI', async () => {
    const json = await request(app.getHttpServer()).get('/api/docs/json');
    expect(json.status).toBe(200);
    expect(json.body.openapi).toBe('3.1.0');
    expect(Object.keys(json.body.paths)).toContain('/orders');
    const ui = await request(app.getHttpServer()).get('/api/docs').redirects(3);
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger');
  });

  it('reports readiness per upstream', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.checks).toEqual({ catalog: true, orders: true, payments: false });
  });

  it('rate limits per client and bucket with a problem body', async () => {
    const server = app.getHttpServer();
    let last = await request(server).get('/api/v1/orders');
    for (let attempt = 0; attempt < 6 && last.status !== 429; attempt++) last = await request(server).get('/api/v1/orders');
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(last.headers['retry-after']).toBeDefined();
  });
});
