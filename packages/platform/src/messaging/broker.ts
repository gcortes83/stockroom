import { Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import * as amqp from 'amqp-connection-manager';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { type AnyEvent, type EventEnvelope, parseEvent } from '@stockroom/contracts';
import { PermanentMessageError } from '../errors';
import { withConsumerSpan } from '../trace-context';

export const EVENTS_EXCHANGE = 'stockroom.events';
export const RETRY_EXCHANGE = 'stockroom.retry';
export const DEAD_LETTER_EXCHANGE = 'stockroom.dlx';
export const RETRY_DELAYS_MS = [1000, 5000, 30000] as const;

export type QueueSpec = { name: string; bindings: string[]; prefetch?: number };
export type EventHandler = (event: AnyEvent) => Promise<void>;

const retryQueueName = (queue: string, delay: number) => `${queue}.retry.${delay / 1000}s`;
const deadLetterQueueName = (queue: string) => `${queue}.dlq`;

async function assertExchanges(channel: ConfirmChannel): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
}

export type DeliveryChannel = Pick<ConfirmChannel, 'ack' | 'publish'>;
export type DeliveryOutcome = 'acked' | 'retried' | 'dead-lettered' | 'abandoned';
type DeliveryLogger = Pick<Logger, 'warn' | 'error' | 'debug'>;

export async function processDelivery(
  channel: DeliveryChannel,
  queue: string,
  message: ConsumeMessage,
  handler: EventHandler,
  logger: DeliveryLogger,
): Promise<DeliveryOutcome> {
  const attempt = Number(message.properties.headers?.['x-attempt'] ?? 0);
  let failure: unknown = undefined;
  let failed = false;
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(message.content.toString('utf8'));
    } catch {
      throw new PermanentMessageError('Message body is not valid JSON');
    }
    const parsed = parseEvent(raw);
    if (parsed.kind === 'invalid') throw new PermanentMessageError(parsed.reason);
    if (parsed.kind === 'unknown-type') logger.debug(`Ignoring unknown event type ${parsed.type} on ${queue}`);
    else await handler(parsed.event);
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    if (!failed) {
      channel.ack(message);
      return 'acked';
    }
    return settleFailure(channel, queue, message, attempt, failure, logger);
  } catch (channelError) {
    logger.warn(
      { messageId: message.properties.messageId, correlationId: message.properties.correlationId },
      `Could not settle a message on ${queue} (${(channelError as Error).message}); RabbitMQ will redeliver it`,
    );
    return 'abandoned';
  }
}

function settleFailure(
  channel: DeliveryChannel,
  queue: string,
  message: ConsumeMessage,
  attempt: number,
  error: unknown,
  logger: DeliveryLogger,
): DeliveryOutcome {
  const reason = error instanceof Error ? error.message : String(error);
  const permanent = error instanceof PermanentMessageError;
  const delay = RETRY_DELAYS_MS[attempt];
  const headers = { ...(message.properties.headers ?? {}), 'x-attempt': attempt + 1, 'x-last-error': reason.slice(0, 500) };
  const options = { ...message.properties, headers, persistent: true };
  const context = { messageId: message.properties.messageId, correlationId: message.properties.correlationId, attempt: attempt + 1 };
  if (!permanent && delay !== undefined) {
    logger.warn(context, `Handler failed on ${queue}, retrying in ${delay}ms: ${reason}`);
    channel.publish(RETRY_EXCHANGE, retryQueueName(queue, delay), message.content, options);
    channel.ack(message);
    return 'retried';
  }
  logger.error(context, `Message dead-lettered from ${queue}: ${reason}`);
  channel.publish(DEAD_LETTER_EXCHANGE, deadLetterQueueName(queue), message.content, options);
  channel.ack(message);
  return 'dead-lettered';
}

export class Broker {
  private readonly logger = new Logger('Broker');
  private readonly connection: AmqpConnectionManager;
  private readonly publisher: ChannelWrapper;
  private readonly consumers: ChannelWrapper[] = [];
  private inFlight = 0;
  private stopping = false;

  constructor(url: string) {
    this.connection = amqp.connect([url], { heartbeatIntervalInSeconds: 15, reconnectTimeInSeconds: 2 });
    this.connection.on('connect', () => this.logger.log('Connected to RabbitMQ'));
    this.connection.on('disconnect', ({ err }) => this.logger.warn(`Disconnected from RabbitMQ: ${err?.message ?? 'unknown'}`));
    this.publisher = this.connection.createChannel({ json: false, publishTimeout: 5000, setup: assertExchanges });
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  async publish(event: EventEnvelope, headers: Record<string, string> = {}): Promise<void> {
    await this.publisher.publish(EVENTS_EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
      messageId: event.id,
      type: event.type,
      correlationId: event.correlationId,
      contentType: 'application/json',
      persistent: true,
      timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
      headers,
    });
  }

  consume(queue: QueueSpec, handler: EventHandler): void {
    const wrapper = this.connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        await assertExchanges(channel);
        await channel.assertQueue(queue.name, { durable: true });
        for (const binding of queue.bindings) await channel.bindQueue(queue.name, EVENTS_EXCHANGE, binding);
        await channel.bindQueue(queue.name, RETRY_EXCHANGE, queue.name);
        for (const delay of RETRY_DELAYS_MS) {
          const retryQueue = retryQueueName(queue.name, delay);
          await channel.assertQueue(retryQueue, {
            durable: true,
            messageTtl: delay,
            deadLetterExchange: RETRY_EXCHANGE,
            deadLetterRoutingKey: queue.name,
          });
          await channel.bindQueue(retryQueue, RETRY_EXCHANGE, retryQueue);
        }
        const deadLetterQueue = deadLetterQueueName(queue.name);
        await channel.assertQueue(deadLetterQueue, { durable: true });
        await channel.bindQueue(deadLetterQueue, DEAD_LETTER_EXCHANGE, deadLetterQueue);
        await channel.prefetch(queue.prefetch ?? 10);
        await channel.consume(queue.name, (message) => {
          if (message) void this.onMessage(channel, queue.name, message, handler);
        });
      },
    });
    this.consumers.push(wrapper);
  }

  private async onMessage(
    channel: ConfirmChannel,
    queue: string,
    message: ConsumeMessage,
    handler: EventHandler,
  ): Promise<void> {
    if (this.stopping) {
      try {
        channel.nack(message, false, true);
      } catch {
        return;
      }
      return;
    }
    this.inFlight++;
    try {
      await withConsumerSpan(
        message.properties.headers,
        `${String(message.properties.type ?? 'message')} process`,
        { 'messaging.system': 'rabbitmq', 'messaging.destination.name': queue, 'messaging.message.id': String(message.properties.messageId ?? '') },
        () => processDelivery(channel, queue, message, handler, this.logger),
      );
    } finally {
      this.inFlight--;
    }
  }

  async stopConsumers(timeoutMs = 10_000): Promise<void> {
    this.stopping = true;
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) await sleep(50);
    await Promise.all(this.consumers.map((consumer) => consumer.close().catch(() => undefined)));
  }

  async close(): Promise<void> {
    await this.publisher.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}
