import { type DynamicModule, Global, Module } from '@nestjs/common';
import { InfraModule, loggingModule } from '@stockroom/platform';
import { CATALOG_CONFIG, CATALOG_SESSION_SETTINGS, type CatalogConfig } from './config';
import { ImportsModule } from './modules/imports/imports.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductsModule } from './modules/products/products.module';

@Global()
@Module({})
class ConfigModule {
  static forRoot(config: CatalogConfig): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: CATALOG_CONFIG, useValue: config }], exports: [CATALOG_CONFIG] };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: CatalogConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        loggingModule({ service: 'catalog', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY }),
        InfraModule.forRoot({
          producer: 'catalog',
          databaseUrl: config.DATABASE_URL,
          amqpUrl: config.AMQP_URL,
          outboxIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
          sessionSettings: CATALOG_SESSION_SETTINGS,
        }),
        ProductsModule,
        ImportsModule,
        InventoryModule,
      ],
    };
  }
}
