import {
  type BeforeApplicationShutdown,
  Controller,
  type DynamicModule,
  Get,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Producer } from '@stockroom/contracts';
import { createDatabase, type Database, type SessionSettings } from './db/database';
import { Broker } from './messaging/broker';
import { OutboxRelay } from './messaging/outbox';
import { CLOCK, systemClock } from './ids';

export const DATABASE = 'STOCKROOM_DATABASE';
export const BROKER = 'STOCKROOM_BROKER';

export type InfraOptions = {
  producer: Producer;
  databaseUrl: string;
  amqpUrl: string;
  outboxIntervalMs: number;
  sessionSettings?: SessionSettings;
};

@Injectable()
class InfraLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BROKER) private readonly broker: Broker,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
  ) {}

  onApplicationBootstrap(): void {
    this.relay.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.broker.stopConsumers();
    await this.relay.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.broker.close();
    await this.db.close();
  }
}

@Controller('health')
class InfraHealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BROKER) private readonly broker: Broker,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
  ) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<Record<string, unknown>> {
    const database = await this.db.ping().catch(() => false);
    const broker = this.broker.isConnected();
    const backlog = database ? await this.relay.backlog().catch(() => -1) : -1;
    const outbox = backlog >= 0 && backlog < 1000;
    const ready = database && broker && outbox;
    if (!ready) void reply.status(503);
    return { status: ready ? 'ok' : 'unavailable', checks: { database, broker, outbox, outboxBacklog: backlog } };
  }
}

@Global()
@Module({})
export class InfraModule {
  static forRoot(options: InfraOptions): DynamicModule {
    return {
      module: InfraModule,
      global: true,
      controllers: [InfraHealthController],
      providers: [
        { provide: DATABASE, useFactory: () => createDatabase(options.databaseUrl, 10, options.sessionSettings) },
        { provide: BROKER, useFactory: () => new Broker(options.amqpUrl) },
        { provide: CLOCK, useValue: systemClock },
        {
          provide: OutboxRelay,
          useFactory: (db: Database, broker: Broker) =>
            new OutboxRelay(db, broker, options.producer, options.outboxIntervalMs),
          inject: [DATABASE, BROKER],
        },
        InfraLifecycle,
      ],
      exports: [DATABASE, BROKER, CLOCK, OutboxRelay],
    };
  }
}
