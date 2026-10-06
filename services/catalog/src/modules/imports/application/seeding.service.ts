import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { DATABASE, type Database } from '@stockroom/platform';
import { CATALOG_CONFIG, type CatalogConfig } from '../../../config';
import { ImportRepository } from '../infrastructure/import.repository';
import { ImportService } from './import.service';

const SEED_LOCK_KEY = 727_001;

@Injectable()
export class SeedingService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Seeding');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ImportRepository) private readonly imports: ImportRepository,
    @Inject(ImportService) private readonly importer: ImportService,
    @Inject(CATALOG_CONFIG) private readonly config: CatalogConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.SEED_ON_START) return;
    try {
      await this.seed();
    } catch (error) {
      this.logger.error(`Seeding failed: ${(error as Error).message}`);
    }
  }

  async seed(): Promise<boolean> {
    const client = await this.db.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [SEED_LOCK_KEY]);
      if (!rows[0]?.locked) return false;
      try {
        if ((await this.imports.hasSeedJob()) || (await this.imports.productCount()) > 0) return false;
        await access(this.config.SEED_FILE);
        const job = await this.importer.importCsv(createReadStream(this.config.SEED_FILE), this.config.SEED_FILENAME, 'SEED');
        this.logger.log(`Seeded catalog: ${job.totals.created} products created, ${job.totals.rejected} rows rejected`);
        return true;
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  }
}
