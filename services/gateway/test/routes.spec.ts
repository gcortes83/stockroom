import { describe, expect, it } from 'vitest';
import { gatewayConfigSchema } from '../src/config';
import { PROXY_ROUTES, rateBucket, upstreamUrl } from '../src/routes';

describe('gateway routing', () => {
  const config = gatewayConfigSchema.parse({});

  it('never exposes internal endpoints', () => {
    expect(PROXY_ROUTES.some((route) => route.rewritePrefix.startsWith('/internal'))).toBe(false);
  });

  it('maps each public prefix to its owning service', () => {
    expect(PROXY_ROUTES.map((route) => [route.prefix, upstreamUrl(config, route.upstream)])).toEqual([
      ['/api/v1/products', 'http://catalog:3001'],
      ['/api/v1/categories', 'http://catalog:3001'],
      ['/api/v1/imports', 'http://catalog:3001'],
      ['/api/v1/orders', 'http://orders:3002'],
      ['/api/v1/payments/methods', 'http://payments:3003'],
    ]);
  });

  it('applies stricter rate limits to expensive writes', () => {
    expect(rateBucket('POST', '/api/v1/imports', 300)).toEqual({ name: 'imports', max: 10 });
    expect(rateBucket('POST', '/api/v1/orders', 300)).toEqual({ name: 'orders', max: 30 });
    expect(rateBucket('GET', '/api/v1/orders/1', 300)).toEqual({ name: 'default', max: 300 });
  });
});
