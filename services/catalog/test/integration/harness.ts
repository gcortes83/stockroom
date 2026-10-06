import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, type Database, runMigrations, type Clock } from '@stockroom/platform';
import { CATALOG_SESSION_SETTINGS, catalogConfigSchema, type CatalogConfig } from '../../src/config';
import { startCatalogPostgres } from '../support/postgres';
import { ProductRepository } from '../../src/modules/products/infrastructure/product.repository';
import { ProductsService } from '../../src/modules/products/application/products.service';
import { ImportRepository } from '../../src/modules/imports/infrastructure/import.repository';
import { ImportService } from '../../src/modules/imports/application/import.service';
import { InventoryService } from '../../src/modules/inventory/application/inventory.service';

export type Harness = {
  container: StartedPostgreSqlContainer;
  db: Database;
  config: CatalogConfig;
  clock: Clock & { set(date: Date): void };
  products: ProductRepository;
  productsService: ProductsService;
  importer: ImportService;
  imports: ImportRepository;
  inventory: InventoryService;
  reset(): Promise<void>;
  stop(): Promise<void>;
};

export async function startHarness(): Promise<Harness> {
  const { container, url } = await startCatalogPostgres();
  await runMigrations(url, join(__dirname, '..', '..', 'migrations'));
  const db = createDatabase(url, 30, CATALOG_SESSION_SETTINGS);
  const config = catalogConfigSchema.parse({ DATABASE_URL: url, AMQP_URL: 'amqp://unused', IMPORT_BATCH_SIZE: '25' });
  let current = new Date('2026-10-05T16:00:00.000Z');
  const clock = { now: () => current, set: (date: Date) => (current = date) };
  const products = new ProductRepository(db);
  const imports = new ImportRepository(db);
  return {
    container,
    db,
    config,
    clock,
    products,
    productsService: new ProductsService(db, products),
    importer: new ImportService(db, imports, products, config),
    imports,
    inventory: new InventoryService(db, clock, config),
    async reset() {
      await db.query(
        'TRUNCATE products, categories, stock_reservations, import_jobs, import_row_issues, outbox, processed_messages CASCADE',
      );
    },
    async stop() {
      await db.close();
      await container.stop();
    },
  };
}
