import type { GatewayConfig } from './config';

export type Upstream = 'catalog' | 'orders' | 'payments';

export type ProxyRoute = { prefix: string; rewritePrefix: string; upstream: Upstream };

export const PROXY_ROUTES: readonly ProxyRoute[] = [
  { prefix: '/api/v1/products', rewritePrefix: '/v1/products', upstream: 'catalog' },
  { prefix: '/api/v1/categories', rewritePrefix: '/v1/categories', upstream: 'catalog' },
  { prefix: '/api/v1/imports', rewritePrefix: '/v1/imports', upstream: 'catalog' },
  { prefix: '/api/v1/orders', rewritePrefix: '/v1/orders', upstream: 'orders' },
  { prefix: '/api/v1/payments/methods', rewritePrefix: '/v1/payments/methods', upstream: 'payments' },
];

export function upstreamUrl(config: GatewayConfig, upstream: Upstream): string {
  return { catalog: config.CATALOG_URL, orders: config.ORDERS_URL, payments: config.PAYMENTS_URL }[upstream];
}

export type RateBucket = { name: string; max: number };

export function rateBucket(method: string, url: string, defaultMax: number): RateBucket {
  if (method === 'POST' && url.startsWith('/api/v1/imports')) return { name: 'imports', max: 10 };
  if (method === 'POST' && url.startsWith('/api/v1/orders')) return { name: 'orders', max: 30 };
  if (method === 'POST' && url.startsWith('/api/v1/payments')) return { name: 'payments', max: 30 };
  return { name: 'default', max: defaultMax };
}
