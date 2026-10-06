import { z } from 'zod';
import { infraConfigSchema, loadConfig } from '@stockroom/platform';

export const ordersConfigSchema = infraConfigSchema.extend({
  PORT: z.coerce.number().int().positive().default(3002),
  CATALOG_URL: z.string().min(1).default('http://catalog:3001'),
  SNAPSHOT_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
});

export type OrdersConfig = z.output<typeof ordersConfigSchema>;

export const ORDERS_CONFIG = 'ORDERS_CONFIG';

export const loadOrdersConfig = (): OrdersConfig => loadConfig(ordersConfigSchema);
