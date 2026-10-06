import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type AnyEvent, EventTypes } from '@stockroom/contracts';
import { BROKER, type Broker, DATABASE, type Database, handleOnce, OutboxRelay } from '@stockroom/platform';
import { SagaService } from '../application/saga.service';

export const SAGA_QUEUE = 'orders.saga';

@Injectable()
export class SagaConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BROKER) private readonly broker: Broker,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
    @Inject(SagaService) private readonly saga: SagaService,
  ) {}

  onApplicationBootstrap(): void {
    this.broker.consume(
      {
        name: SAGA_QUEUE,
        bindings: [
          EventTypes.StockReserved,
          EventTypes.StockReservationFailed,
          EventTypes.StockReservationExpired,
          EventTypes.StockCommitFailed,
          EventTypes.PaymentSucceeded,
          EventTypes.PaymentFailed,
          EventTypes.PaymentRefunded,
        ],
      },
      (event) => this.handle(event),
    );
  }

  async handle(event: AnyEvent): Promise<void> {
    const processed = await handleOnce(this.db, SAGA_QUEUE, event.id, (tx) => this.saga.handle(tx, event));
    if (processed) this.relay.notify();
  }
}
