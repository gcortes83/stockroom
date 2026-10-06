import '@stockroom/platform/tracing';
import 'reflect-metadata';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { createHttpApp, listen, runMigrations } from '@stockroom/platform';
import { AppModule } from './app.module';
import { loadPaymentsConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadPaymentsConfig();
  const logger = new Logger('Bootstrap');
  await runMigrations(config.DATABASE_URL, join(__dirname, '..', 'migrations'), (message) => logger.log(message));
  const app = await createHttpApp(AppModule.forRoot(config));
  await listen(app, config.PORT);
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`Payments failed to start: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
