import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type EventEnvelope, EventTypes } from '@stockroom/contracts';
import { handleOnce, newId } from '@stockroom/platform';
import { type Harness, startHarness } from './harness';

const envelope = <T extends EventEnvelope['type']>(type: T, payload: unknown): EventEnvelope<T> =>
  ({
    id: newId(),
    type,
    occurredAt: new Date().toISOString(),
    correlationId: 'test',
    causationId: null,
    producer: 'orders',
    payload,
  }) as EventEnvelope<T>;

describe('inventory reservations', () => {
  let h: Harness;
  let productId: string;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h?.stop());

  beforeEach(async () => {
    await h.reset();
    const product = await h.productsService.create({
      sku: 'LAST-1',
      name: 'Last unit',
      description: '',
      category: 'Misc',
      priceCents: 1000,
      stock: 1,
      weightGrams: null,
    });
    productId = product.id;
  });

  const stock = async () =>
    (await h.db.query<{ stock: number; reserved: number }>('SELECT stock, reserved FROM products WHERE id = $1', [productId]))
      .rows[0];

  const outboxTypes = async () =>
    (await h.db.query<{ type: string }>('SELECT type FROM outbox ORDER BY occurred_at')).rows.map((row) => row.type);

  const created = (orderId: string, quantity = 1) =>
    envelope(EventTypes.OrderCreated, { orderId, lines: [{ productId, sku: 'LAST-1', quantity }] });

  it('lets exactly one of 20 concurrent orders reserve the last unit', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => h.db.transaction((tx) => h.inventory.reserve(tx, created(newId())))),
    );
    expect(outcomes.filter((outcome) => outcome === 'reserved')).toHaveLength(1);
    expect(await stock()).toEqual({ stock: 1, reserved: 1 });
    const types = await outboxTypes();
    expect(types.filter((type) => type === EventTypes.StockReserved)).toHaveLength(1);
    expect(types.filter((type) => type === EventTypes.StockReservationFailed)).toHaveLength(19);
  });

  it('commits a reservation on confirmation and is idempotent', async () => {
    const orderId = newId();
    await h.db.transaction((tx) => h.inventory.reserve(tx, created(orderId)));
    const confirmed = envelope(EventTypes.OrderConfirmed, { orderId });
    expect(await h.db.transaction((tx) => h.inventory.commit(tx, confirmed))).toBe('committed');
    expect(await h.db.transaction((tx) => h.inventory.commit(tx, confirmed))).toBe('noop');
    expect(await stock()).toEqual({ stock: 0, reserved: 0 });
  });

  it('releases a reservation on cancellation', async () => {
    const orderId = newId();
    await h.db.transaction((tx) => h.inventory.reserve(tx, created(orderId)));
    await h.db.transaction((tx) =>
      h.inventory.release(tx, envelope(EventTypes.OrderCancelled, { orderId, reason: 'PAYMENT_DECLINED' })),
    );
    expect(await stock()).toEqual({ stock: 1, reserved: 0 });
  });

  it('expires stale reservations and emits one event per order', async () => {
    const orderId = newId();
    await h.db.transaction((tx) => h.inventory.reserve(tx, created(orderId)));
    h.clock.set(new Date(h.clock.now().getTime() + (h.config.RESERVATION_TTL_SECONDS + 1) * 1000));
    expect(await h.inventory.sweepExpired()).toBe(1);
    expect(await stock()).toEqual({ stock: 1, reserved: 0 });
    expect(await outboxTypes()).toContain(EventTypes.StockReservationExpired);
    h.clock.set(new Date('2026-10-05T16:00:00.000Z'));
  });

  it('commits after expiry when stock is still available, otherwise reports commit failure', async () => {
    const first = newId();
    await h.db.transaction((tx) => h.inventory.reserve(tx, created(first)));
    h.clock.set(new Date(h.clock.now().getTime() + (h.config.RESERVATION_TTL_SECONDS + 1) * 1000));
    await h.inventory.sweepExpired();
    h.clock.set(new Date('2026-10-05T16:00:00.000Z'));
    const second = newId();
    await h.db.transaction((tx) => h.inventory.reserve(tx, created(second)));
    const outcome = await h.db.transaction((tx) => h.inventory.commit(tx, envelope(EventTypes.OrderConfirmed, { orderId: first })));
    expect(outcome).toBe('failed');
    expect(await outboxTypes()).toContain(EventTypes.StockCommitFailed);
    expect(await stock()).toEqual({ stock: 1, reserved: 1 });
  });

  it('rejects deleting a product with active reservations', async () => {
    await h.db.transaction((tx) => h.inventory.reserve(tx, created(newId())));
    await expect(h.productsService.delete(productId)).rejects.toMatchObject({ code: 'PRODUCT_HAS_ACTIVE_RESERVATIONS' });
  });

  it('processes a duplicated message only once', async () => {
    const event = created(newId());
    const run = () => handleOnce(h.db, 'catalog.inventory', event.id, async (tx) => void (await h.inventory.reserve(tx, event)));
    expect(await run()).toBe(true);
    expect(await run()).toBe(false);
    expect(await stock()).toEqual({ stock: 1, reserved: 1 });
  });
});

describe('product concurrency control', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h?.stop());

  it('detects stale versions and missing preconditions', async () => {
    const product = await h.productsService.create({
      sku: 'VER-1',
      name: 'Versioned',
      description: '',
      category: 'Misc',
      priceCents: 100,
      stock: 5,
      weightGrams: null,
    });
    const input = { name: 'Renamed', description: '', category: 'Misc', priceCents: 200, stock: 5, weightGrams: null };
    const updated = await h.productsService.update(product.id, 1, input);
    expect(updated.version).toBe(2);
    await expect(h.productsService.update(product.id, 1, input)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      extensions: { currentVersion: 2 },
    });
    await expect(h.productsService.update(product.id, null, input)).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED' });
  });

  it('rejects duplicate SKUs', async () => {
    const input = { sku: 'DUP-1', name: 'A', description: '', category: 'Misc', priceCents: 1, stock: 1, weightGrams: null };
    await h.productsService.create(input);
    await expect(h.productsService.create(input)).rejects.toMatchObject({ code: 'DUPLICATE_SKU', status: 409 });
  });
});
