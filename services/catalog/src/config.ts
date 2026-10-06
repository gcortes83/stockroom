import { join } from 'node:path';
import { z } from 'zod';
import { infraConfigSchema, loadConfig } from '@stockroom/platform';

export const catalogConfigSchema = infraConfigSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  RESERVATION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
  IMPORT_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  SEED_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  SEED_FILE: z.string().default(join(__dirname, '..', 'seed', 'example.csv')),
  SEED_FILENAME: z.string().default('Code Challenge E-Commerce.csv'),
});

export type CatalogConfig = z.output<typeof catalogConfigSchema>;

export const CATALOG_CONFIG = 'CATALOG_CONFIG';

export const CATALOG_SESSION_SETTINGS = { 'pg_trgm.word_similarity_threshold': 0.5 } as const;

export const loadCatalogConfig = (): CatalogConfig => loadConfig(catalogConfigSchema);
