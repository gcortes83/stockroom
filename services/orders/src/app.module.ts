import { type DynamicModule, Module } from '@nestjs/common';
import { InfraModule, loggingModule } from '@stockroom/platform';
import { ORDERS_CONFIG, type OrdersConfig } from './config';
import { OrdersService } from './application/orders.service';
import { SagaService } from './application/saga.service';
import { CATALOG_PORT, HttpCatalogClient } from './infrastructure/catalog.client';
import { OrderRepository } from './infrastructure/order.repository';
import { OrdersController } from './interface/orders.controller';
import { SagaConsumer } from './interface/saga.consumer';

@Module({})
export class AppModule {
  static forRoot(config: OrdersConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        loggingModule({ service: 'orders', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY }),
        InfraModule.forRoot({
          producer: 'orders',
          databaseUrl: config.DATABASE_URL,
          amqpUrl: config.AMQP_URL,
          outboxIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
        }),
      ],
      controllers: [OrdersController],
      providers: [
        { provide: ORDERS_CONFIG, useValue: config },
        { provide: CATALOG_PORT, useClass: HttpCatalogClient },
        OrderRepository,
        OrdersService,
        SagaService,
        SagaConsumer,
      ],
    };
  }
}
