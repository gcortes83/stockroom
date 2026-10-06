import '@stockroom/platform/tracing';
import 'reflect-metadata';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import { Logger } from '@nestjs/common';
import { createHttpApp, listen, runMigrations } from '@stockroom/platform';
import { AppModule } from './app.module';
import { loadCatalogConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadCatalogConfig();
  const logger = new Logger('Bootstrap');
  await runMigrations(config.DATABASE_URL, join(__dirname, '..', 'migrations'), (message) => logger.log(message));
  const app = await createHttpApp(AppModule.forRoot(config), {
    configure: async (instance) => {
      await instance.register(multipart, { limits: { fileSize: config.IMPORT_MAX_BYTES, files: 1 } });
    },
  });
  await listen(app, config.PORT);
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`Catalog failed to start: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
