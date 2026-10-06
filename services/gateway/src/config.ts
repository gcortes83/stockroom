import { z } from 'zod';
import { baseConfigSchema, loadConfig } from '@stockroom/platform';

export const gatewayConfigSchema = baseConfigSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  CATALOG_URL: z.string().min(1).default('http://catalog:3001'),
  ORDERS_URL: z.string().min(1).default('http://orders:3002'),
  PAYMENTS_URL: z.string().min(1).default('http://payments:3003'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
});

export type GatewayConfig = z.output<typeof gatewayConfigSchema>;

export const GATEWAY_CONFIG = 'GATEWAY_CONFIG';

export const loadGatewayConfig = (): GatewayConfig => loadConfig(gatewayConfigSchema);
