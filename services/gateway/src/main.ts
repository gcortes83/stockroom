import '@stockroom/platform/tracing';
import 'reflect-metadata';
import { listen } from '@stockroom/platform';
import { buildGateway } from './app';
import { loadGatewayConfig } from './config';

void (async () => {
  const config = loadGatewayConfig();
  const app = await buildGateway(config);
  await listen(app, config.PORT);
})().catch((error: unknown) => {
  process.stderr.write(`Gateway failed to start: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
