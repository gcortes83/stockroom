import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AnyEvent, EventTypes, type PlaceOrder, type ProductSnapshot } from '@stockroom/contracts';
import { createDatabase, type Database, handleOnce, newId, type OutboxRelay, runMigrations } from '@stockroom/platform';
import { OrdersService } from '../../src/application/orders.service';
import { SagaService } from '../../src/application/saga.service';
import type { CatalogPort } from '../../src/infrastructure/catalog.client';
import { OrderRepository } from '../../src/infrastructure/order.repository';

const productId = '0190a3c2-7d1e-7b2a-9c4f-1f2e3d4c5b6a';

class FakeCatalog implements CatalogPort {
  products: ProductSnapshot[] = [];
  async snapshot(ids: string[]): Promise<ProductSnapshot[]> {
    return this.products.filter((product) => ids.includes(product.id));
  }
}

const relay = { notify: () => undefined } as unknown as OutboxRelay;

describe('orders with PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;
  let service: OrdersService;
  let saga: SagaService;
  const catalog = new FakeCatalog();

  const input = (overrides: Partial<PlaceOrder> = {}): PlaceOrder => ({
    customer: { name: 'Ada', email: 'ada@example.com' },
    lines: [{ productId, quantity: 2 }],
    paymentMethodId: 'pm_abcdefghijklmnopqrstuvwx',
    ...overrides,
  });

  const event = (type: string, payload: unknown): AnyEvent =>
    ({ id: newId(), type, occurredAt: new Date().toISOString(), correlationId: 'c', causationId: null, producer: 'catalog', payload }) as AnyEvent;

  const apply = (e: AnyEvent) => handleOnce(db, 'orders.saga', e.id, (tx) => saga.handle(tx, e));

  const outbox = async () =>
    (await db.query<{ type: string; payload: Record<string, unknown> }>('SELECT type, payload FROM outbox ORDER BY occurred_at, id')).rows;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    await runMigrations(container.getConnectionUri(), join(__dirname, '..', '..', 'migrations'));
    db = createDatabase(container.getConnectionUri(), 20);
    const repository = new OrderRepository(db);
    service = new OrdersService(db, repository, catalog, relay);
    saga = new SagaService(repository);
  });

  afterAll(async () => {
    await db?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    await db.query('TRUNCATE orders, order_lines, order_status_history, outbox, processed_messages CASCADE');
    catalog.products = [
      { id: productId, sku: 'RS-001', name: 'Running Shoes', priceCents: 9499, currency: 'USD', available: 5, active: true },
    ];
  });

  it('creates a pending order with server-side totals and an OrderCreated event', async () => {
    const { order, replayed } = await service.place(input(), newId(), 'corr-1');
    expect(replayed).toBe(false);
    expect(order).toMatchObject({ status: 'PENDING', total: { amountCents: 18998 }, lines: [{ sku: 'RS-001', quantity: 2 }] });
    expect((await outbox()).map((row) => row.type)).toEqual([EventTypes.OrderCreated]);
  });

  it('replays the same idempotency key and rejects a different body', async () => {
    const key = newId();
    const first = await service.place(input(), key, 'c');
    const second = await service.place(input(), key, 'c');
    expect(second).toMatchObject({ replayed: true, order: { id: first.order.id } });
    await expect(service.place(input({ lines: [{ productId, quantity: 1 }] }), key, 'c')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('creates exactly one order for concurrent requests with the same key', async () => {
    const key = newId();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.place(input(), key, 'c')));
    const ids = new Set(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value.order.id] : [])));
    expect(ids.size).toBe(1);
    const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM orders');
    expect(rows[0]?.count).toBe(1);
  });

  it('rejects price changes, unavailable products and insufficient stock', async () => {
    await expect(service.place(input({ expectedTotalCents: 100 }), newId(), 'c')).rejects.toMatchObject({
      code: 'PRICE_CHANGED',
      extensions: { totalCents: 18998 },
    });
    await expect(service.place(input({ lines: [{ productId, quantity: 9 }] }), newId(), 'c')).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    catalog.products = [];
    await expect(service.place(input(), newId(), 'c')).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  });

  it('runs the happy-path saga to CONFIRMED', async () => {
    const { order } = await service.place(input(), newId(), 'c');
    await apply(event(EventTypes.StockReserved, { orderId: order.id, expiresAt: new Date().toISOString() }));
    expect((await service.get(order.id)).status).toBe('AWAITING_PAYMENT');
    const charge = (await outbox()).find((row) => row.type === EventTypes.ChargeRequested);
    expect(charge?.payload).toMatchObject({ orderId: order.id, amountCents: 18998, paymentMethodId: 'pm_abcdefghijklmnopqrstuvwx' });
    await apply(event(EventTypes.PaymentSucceeded, { orderId: order.id, paymentId: newId(), amountCents: 18998, last4: '4242' }));
    const confirmed = await service.get(order.id);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', payment: { status: 'SUCCEEDED', last4: '4242' } });
    expect(confirmed.history.map((entry) => entry.to)).toEqual(['PENDING', 'AWAITING_PAYMENT', 'CONFIRMED']);
    expect((await outbox()).map((row) => row.type)).toContain(EventTypes.OrderConfirmed);
  });

  it('cancels on declined payment and asks catalog to release stock', async () => {
    const { order } = await service.place(input(), newId(), 'c');
    await apply(event(EventTypes.StockReserved, { orderId: order.id, expiresAt: new Date().toISOString() }));
    await apply(event(EventTypes.PaymentFailed, { orderId: order.id, reason: 'CARD_DECLINED', last4: '0002' }));
    expect(await service.get(order.id)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { reason: 'PAYMENT_DECLINED' },
      payment: { status: 'FAILED', declineReason: 'CARD_DECLINED' },
    });
    expect((await outbox()).map((row) => row.type)).toContain(EventTypes.OrderCancelled);
  });

  it('requests a refund when payment succeeds after expiry cancelled the order', async () => {
    const { order } = await service.place(input(), newId(), 'c');
    await apply(event(EventTypes.StockReserved, { orderId: order.id, expiresAt: new Date().toISOString() }));
    await apply(event(EventTypes.StockReservationExpired, { orderId: order.id }));
    await apply(event(EventTypes.PaymentSucceeded, { orderId: order.id, paymentId: newId(), amountCents: 18998, last4: '4242' }));
    expect((await service.get(order.id)).cancellation?.reason).toBe('RESERVATION_EXPIRED');
    expect((await outbox()).map((row) => row.type)).toContain(EventTypes.RefundRequested);
  });

  it('applies a duplicated event only once', async () => {
    const { order } = await service.place(input(), newId(), 'c');
    const reserved = event(EventTypes.StockReserved, { orderId: order.id, expiresAt: new Date().toISOString() });
    expect(await apply(reserved)).toBe(true);
    expect(await apply(reserved)).toBe(false);
    expect((await outbox()).filter((row) => row.type === EventTypes.ChargeRequested)).toHaveLength(1);
  });
});
