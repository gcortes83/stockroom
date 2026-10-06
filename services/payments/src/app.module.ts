import { type DynamicModule, Module } from '@nestjs/common';
import { InfraModule, loggingModule } from '@stockroom/platform';
import { PAYMENTS_CONFIG, type PaymentsConfig } from './config';
import { PaymentsService } from './application/payments.service';
import { PaymentMethodsController, PaymentsConsumer } from './interface/payments.controller';

@Module({})
export class AppModule {
  static forRoot(config: PaymentsConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        loggingModule({ service: 'payments', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY }),
        InfraModule.forRoot({
          producer: 'payments',
          databaseUrl: config.DATABASE_URL,
          amqpUrl: config.AMQP_URL,
          outboxIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
        }),
      ],
      controllers: [PaymentMethodsController],
      providers: [{ provide: PAYMENTS_CONFIG, useValue: config }, PaymentsService, PaymentsConsumer],
    };
  }
}
