import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type AnyEvent, EventTypes } from '@stockroom/contracts';
import { BROKER, type Broker, DATABASE, type Database, handleOnce, OutboxRelay } from '@stockroom/platform';
import { CATALOG_CONFIG, type CatalogConfig } from '../../../config';
import { InventoryService } from '../application/inventory.service';

export const INVENTORY_QUEUE = 'catalog.inventory';

@Injectable()
export class InventoryConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('InventoryConsumer');
  private sweeper: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BROKER) private readonly broker: Broker,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(CATALOG_CONFIG) private readonly config: CatalogConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.broker.consume(
      {
        name: INVENTORY_QUEUE,
        bindings: [EventTypes.OrderCreated, EventTypes.OrderConfirmed, EventTypes.OrderCancelled],
      },
      (event) => this.handle(event),
    );
    this.sweeper = setInterval(() => void this.sweep(), this.config.RESERVATION_SWEEP_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  async handle(event: AnyEvent): Promise<void> {
    const processed = await handleOnce(this.db, INVENTORY_QUEUE, event.id, async (tx) => {
      switch (event.type) {
        case EventTypes.OrderCreated: {
          const outcome = await this.inventory.reserve(tx, event);
          this.logger.log({ correlationId: event.correlationId, orderId: event.payload.orderId }, `Stock ${outcome}`);
          return;
        }
        case EventTypes.OrderConfirmed: {
          const outcome = await this.inventory.commit(tx, event);
          this.logger.log({ correlationId: event.correlationId, orderId: event.payload.orderId }, `Commit ${outcome}`);
          return;
        }
        case EventTypes.OrderCancelled: {
          const released = await this.inventory.release(tx, event);
          this.logger.log(
            { correlationId: event.correlationId, orderId: event.payload.orderId },
            `Released ${released} reservations`,
          );
          return;
        }
        default:
          return;
      }
    });
    if (processed) this.relay.notify();
  }

  async sweep(): Promise<void> {
    try {
      const expired = await this.inventory.sweepExpired();
      if (expired > 0) {
        this.logger.log(`Expired reservations for ${expired} orders`);
        this.relay.notify();
      }
    } catch (error) {
      this.logger.warn(`Reservation sweep failed: ${(error as Error).message}`);
    }
  }
}
