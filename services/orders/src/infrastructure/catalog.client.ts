import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  type IPolicy,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';
import { z } from 'zod';
import { type ProductSnapshot, productSnapshotSchema } from '@stockroom/contracts';
import { ORDERS_CONFIG, type OrdersConfig } from '../config';
import { catalogUnavailable } from '../domain/errors';

export interface CatalogPort {
  snapshot(ids: string[], correlationId: string): Promise<ProductSnapshot[]>;
}

export const CATALOG_PORT = 'CATALOG_PORT';

const responseSchema = z.object({ data: z.array(productSnapshotSchema) });

@Injectable()
export class HttpCatalogClient implements CatalogPort {
  private readonly logger = new Logger('CatalogClient');
  private readonly policy: IPolicy;

  constructor(@Inject(ORDERS_CONFIG) private readonly config: OrdersConfig) {
    const breaker = circuitBreaker(handleAll, { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(5) });
    breaker.onBreak(() => this.logger.warn('Catalog circuit opened'));
    breaker.onReset(() => this.logger.log('Catalog circuit closed'));
    const retries = retry(handleAll, { maxAttempts: 2, backoff: new ExponentialBackoff({ initialDelay: 100, maxDelay: 800 }) });
    this.policy = wrap(breaker, retries, timeout(config.SNAPSHOT_TIMEOUT_MS, TimeoutStrategy.Aggressive));
  }

  async snapshot(ids: string[], correlationId: string): Promise<ProductSnapshot[]> {
    const url = `${this.config.CATALOG_URL}/internal/v1/products/snapshot?ids=${ids.map(encodeURIComponent).join(',')}`;
    try {
      return await this.policy.execute(async ({ signal }) => {
        const response = await fetch(url, { signal, headers: { 'x-request-id': correlationId, accept: 'application/json' } });
        if (!response.ok) throw new Error(`Catalog responded with ${response.status}`);
        return responseSchema.parse(await response.json()).data;
      });
    } catch (error) {
      this.logger.warn({ correlationId }, `Catalog snapshot failed: ${(error as Error).message}`);
      throw catalogUnavailable();
    }
  }
}
