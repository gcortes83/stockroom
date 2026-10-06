import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type EventEnvelope, EventTypes } from '@stockroom/contracts';
import { createDatabase, type Database, newId, type OutboxRelay, runMigrations, TransientError } from '@stockroom/platform';
import { PaymentsService } from '../../src/application/payments.service';
import { paymentsConfigSchema } from '../../src/config';

const relay = { notify: () => undefined } as unknown as OutboxRelay;
const now = new Date('2026-10-05T16:00:00.000Z');

const charge = (paymentMethodId: string, amountCents = 1999, orderId = newId()): EventEnvelope<typeof EventTypes.ChargeRequested> => ({
  id: newId(),
  type: EventTypes.ChargeRequested,
  occurredAt: now.toISOString(),
  correlationId: 'test',
  causationId: null,
  producer: 'orders',
  payload: { orderId, amountCents, currency: 'USD', paymentMethodId },
});

const refund = (orderId: string): EventEnvelope<typeof EventTypes.RefundRequested> => ({
  id: newId(),
  type: EventTypes.RefundRequested,
  occurredAt: now.toISOString(),
  correlationId: 'test',
  causationId: null,
  producer: 'orders',
  payload: { orderId, reason: 'PAYMENT_AFTER_CANCELLATION' },
});

describe('payments with PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;
  let service: PaymentsService;
  let clock = now;

  const tokenize = async (cardNumber: string) =>
    (await service.tokenize({ cardNumber, expMonth: 12, expYear: 2030, cvc: '123', holderName: 'Ada' })).id;

  const outbox = async () =>
    (await db.query<{ type: string; payload: Record<string, unknown> }>('SELECT type, payload FROM outbox ORDER BY occurred_at, id')).rows;

  const payment = async (orderId: string) =>
    (await db.query<{ status: string; decline_reason: string | null; last4: string | null }>('SELECT status, decline_reason, last4 FROM payments WHERE order_id = $1', [orderId])).rows;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    await runMigrations(container.getConnectionUri(), join(__dirname, '..', '..', 'migrations'));
    db = createDatabase(container.getConnectionUri());
    const config = paymentsConfigSchema.parse({ DATABASE_URL: container.getConnectionUri(), AMQP_URL: 'amqp://unused', PAYMENT_SIMULATED_LATENCY_MS: '0' });
    service = new PaymentsService(db, { now: () => clock }, config, relay);
  });

  afterAll(async () => {
    await db?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    clock = now;
    await db.query('TRUNCATE payments, payment_methods, outbox, processed_messages CASCADE');
  });

  it('approves a valid card and emits PaymentSucceeded', async () => {
    const event = charge(await tokenize('4242424242424242'));
    await service.charge(event);
    expect(await payment(event.payload.orderId)).toEqual([{ status: 'SUCCEEDED', decline_reason: null, last4: '4242' }]);
    expect(await outbox()).toEqual([
      { type: EventTypes.PaymentSucceeded, payload: expect.objectContaining({ orderId: event.payload.orderId, amountCents: 1999, last4: '4242' }) },
    ]);
  });

  it.each([
    ['4000000000000002', 1999, 'CARD_DECLINED'],
    ['4000000000009995', 1999, 'INSUFFICIENT_FUNDS'],
    ['4242424242424242', 1_000_001, 'LIMIT_EXCEEDED'],
  ])('declines card %s for %i cents with %s', async (card, amount, reason) => {
    const event = charge(await tokenize(card), amount);
    await service.charge(event);
    expect(await payment(event.payload.orderId)).toEqual([expect.objectContaining({ status: 'FAILED', decline_reason: reason })]);
    expect((await outbox())[0]).toEqual({ type: EventTypes.PaymentFailed, payload: expect.objectContaining({ reason }) });
  });

  it('fails unknown or expired payment methods', async () => {
    const unknown = charge('pm_doesnotexist000000000000');
    await service.charge(unknown);
    expect((await payment(unknown.payload.orderId))[0]?.decline_reason).toBe('INVALID_PAYMENT_METHOD');
    const methodId = await tokenize('4242424242424242');
    clock = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const expired = charge(methodId);
    await service.charge(expired);
    expect((await payment(expired.payload.orderId))[0]?.decline_reason).toBe('INVALID_PAYMENT_METHOD');
  });

  it('fails transiently once for the 0119 card and approves the retry', async () => {
    const event = charge(await tokenize('4000000000000119'));
    await expect(service.charge(event)).rejects.toBeInstanceOf(TransientError);
    expect(await payment(event.payload.orderId)).toEqual([]);
    await service.charge(event);
    expect((await payment(event.payload.orderId))[0]?.status).toBe('SUCCEEDED');
  });

  it('processes a duplicated message once and replays the result for a re-sent charge', async () => {
    const methodId = await tokenize('4242424242424242');
    const event = charge(methodId);
    await service.charge(event);
    await service.charge(event);
    await service.charge({ ...event, id: newId() });
    expect(await payment(event.payload.orderId)).toHaveLength(1);
    expect((await outbox()).map((row) => row.type)).toEqual([EventTypes.PaymentSucceeded, EventTypes.PaymentSucceeded]);
  });

  it('replays a stored failure for a re-sent charge', async () => {
    const event = charge(await tokenize('4000000000000002'));
    await service.charge(event);
    await service.charge({ ...event, id: newId() });
    expect((await outbox()).map((row) => row.type)).toEqual([EventTypes.PaymentFailed, EventTypes.PaymentFailed]);
  });

  it('refunds succeeded payments only', async () => {
    const paid = charge(await tokenize('4242424242424242'));
    await service.charge(paid);
    await service.refund(refund(paid.payload.orderId));
    expect((await payment(paid.payload.orderId))[0]?.status).toBe('REFUNDED');
    expect((await outbox()).map((row) => row.type)).toContain(EventTypes.PaymentRefunded);
    const declined = charge(await tokenize('4000000000000002'));
    await service.charge(declined);
    await service.refund(refund(declined.payload.orderId));
    expect((await payment(declined.payload.orderId))[0]?.status).toBe('FAILED');
  });
});
