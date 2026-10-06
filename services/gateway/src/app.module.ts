import { type DynamicModule, Module } from '@nestjs/common';
import { loggingModule } from '@stockroom/platform';
import { GATEWAY_CONFIG, type GatewayConfig } from './config';
import { HealthController } from './health.controller';

@Module({})
export class AppModule {
  static forRoot(config: GatewayConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [loggingModule({ service: 'gateway', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY })],
      controllers: [HealthController],
      providers: [{ provide: GATEWAY_CONFIG, useValue: config }],
    };
  }
}
