import { describe, expect, it, vi } from 'vitest';
import type { ConsumeMessage } from 'amqplib';
import { type DeliveryChannel, processDelivery, RETRY_EXCHANGE, DEAD_LETTER_EXCHANGE } from '../src/messaging/broker';
import { TransientError } from '../src/errors';

const event = {
  id: '0190a3c2-7d1e-7b2a-9c4f-1f2e3d4c5b6a',
  type: 'orders.order.confirmed.v1',
  occurredAt: '2026-10-05T16:00:00.000Z',
  correlationId: 'c-1',
  causationId: null,
  producer: 'orders',
  payload: { orderId: 'o-1' },
};

const message = (body: unknown, attempt?: number): ConsumeMessage =>
  ({
    content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    fields: {},
    properties: { headers: attempt === undefined ? {} : { 'x-attempt': attempt }, messageId: 'm', correlationId: 'c-1' },
  }) as unknown as ConsumeMessage;

const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const channel = (overrides: Partial<DeliveryChannel> = {}) => {
  const fake = { ack: vi.fn(), publish: vi.fn(() => true), ...overrides };
  return fake as unknown as DeliveryChannel & { ack: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn> };
};

describe('processDelivery', () => {
  it('acks after a successful handler', async () => {
    const ch = channel();
    const handler = vi.fn(async () => undefined);
    expect(await processDelivery(ch, 'q', message(event), handler, logger)).toBe('acked');
    expect(handler).toHaveBeenCalledOnce();
    expect(ch.ack).toHaveBeenCalledOnce();
  });

  it('retries transient failures through the first retry tier', async () => {
    const ch = channel();
    const outcome = await processDelivery(ch, 'q', message(event), async () => Promise.reject(new TransientError('boom')), logger);
    expect(outcome).toBe('retried');
    expect(ch.publish).toHaveBeenCalledWith(RETRY_EXCHANGE, 'q.retry.1s', expect.any(Buffer), expect.objectContaining({ headers: expect.objectContaining({ 'x-attempt': 1 }) }));
  });

  it('dead-letters after the last retry and for malformed messages', async () => {
    const failing = async () => Promise.reject(new Error('still failing'));
    expect(await processDelivery(channel(), 'q', message(event, 3), failing, logger)).toBe('dead-lettered');
    const ch = channel();
    expect(await processDelivery(ch, 'q', message('{not json'), failing, logger)).toBe('dead-lettered');
    expect(ch.publish).toHaveBeenCalledWith(DEAD_LETTER_EXCHANGE, 'q.dlq', expect.any(Buffer), expect.any(Object));
  });

  it('never throws when the channel closed while the handler was running', async () => {
    const closed = () => {
      throw new Error('Channel closed');
    };
    const ch = channel({ ack: closed, publish: closed });
    await expect(processDelivery(ch, 'q', message(event), async () => undefined, logger)).resolves.toBe('abandoned');
    await expect(processDelivery(ch, 'q', message(event), async () => Promise.reject(new Error('x')), logger)).resolves.toBe('abandoned');
  });

  it('acks unknown event types without calling the handler', async () => {
    const handler = vi.fn(async () => undefined);
    expect(await processDelivery(channel(), 'q', message({ ...event, type: 'other.thing.v1' }), handler, logger)).toBe('acked');
    expect(handler).not.toHaveBeenCalled();
  });
});
