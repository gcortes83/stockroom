import { describe, expect, it } from 'vitest';
import {
  createProductSchema,
  EventTypes,
  normalizeSku,
  parseEvent,
  placeOrderSchema,
  productListQuerySchema,
  slugify,
} from '../src';

const envelope = (type: string, payload: unknown) => ({
  id: '0190a3c2-7d1e-7b2a-9c4f-1f2e3d4c5b6a',
  type,
  occurredAt: '2026-10-05T16:00:00.000Z',
  correlationId: 'req-1',
  causationId: null,
  producer: 'orders',
  payload,
});

describe('text rules', () => {
  it('normalizes SKUs', () => {
    expect(normalizeSku('  rs 001 ')).toBe('RS-001');
  });

  it('slugifies categories with ampersands', () => {
    expect(slugify('Home & Office')).toBe('home-and-office');
    expect(slugify('Food & Beverage')).toBe('food-and-beverage');
  });
});

describe('createProductSchema', () => {
  it('normalizes input', () => {
    const parsed = createProductSchema.parse({
      sku: 'nb-200',
      name: '  Dotted   Notebook ',
      category: 'Stationery',
      priceCents: 650,
      stock: 3,
    });
    expect(parsed).toMatchObject({ sku: 'NB-200', name: 'Dotted Notebook', description: '', weightGrams: null });
  });

  it('rejects whitespace-only names and negative stock', () => {
    const result = createProductSchema.safeParse({ sku: 'A1', name: '   ', category: 'X', priceCents: 1, stock: -1 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(expect.arrayContaining(['name', 'stock']));
  });
});

describe('productListQuerySchema', () => {
  it('accepts repeated categories and booleans', () => {
    const parsed = productListQuerySchema.parse({ category: ['a', 'b'], inStock: 'true', page: '2' });
    expect(parsed).toMatchObject({ category: ['a', 'b'], inStock: true, page: 2, pageSize: 20, q: '' });
  });

  it('rejects inverted price ranges', () => {
    expect(productListQuerySchema.safeParse({ minPriceCents: '500', maxPriceCents: '100' }).success).toBe(false);
  });
});

describe('placeOrderSchema', () => {
  it('rejects duplicate products', () => {
    const line = { productId: '0190a3c2-7d1e-7b2a-9c4f-1f2e3d4c5b6a', quantity: 1 };
    const result = placeOrderSchema.safeParse({
      customer: { name: 'Ada', email: 'ada@example.com' },
      lines: [line, line],
      paymentMethodId: 'pm_abcdefghijklmnopqrstuvwx',
    });
    expect(result.success).toBe(false);
  });
});

describe('parseEvent', () => {
  it('accepts a valid event', () => {
    const parsed = parseEvent(envelope(EventTypes.OrderConfirmed, { orderId: 'o1' }));
    expect(parsed.kind).toBe('valid');
  });

  it('flags invalid payloads', () => {
    expect(parseEvent(envelope(EventTypes.OrderCreated, { orderId: 'o1', lines: [] })).kind).toBe('invalid');
  });

  it('reports unknown event types', () => {
    expect(parseEvent(envelope('something.else.v1', {}))).toEqual({ kind: 'unknown-type', type: 'something.else.v1' });
  });

  it('validates an example payload for every event type', () => {
    const examples: Record<string, unknown> = {
      [EventTypes.OrderCreated]: { orderId: 'o', lines: [{ productId: 'p', sku: 'S', quantity: 1 }] },
      [EventTypes.OrderConfirmed]: { orderId: 'o' },
      [EventTypes.OrderCancelled]: { orderId: 'o', reason: 'PAYMENT_DECLINED' },
      [EventTypes.StockReserved]: { orderId: 'o', expiresAt: '2026-10-05T16:10:00.000Z' },
      [EventTypes.StockReservationFailed]: { orderId: 'o', lines: [{ productId: 'p', sku: 'S', requested: 2, available: 1 }] },
      [EventTypes.StockReservationExpired]: { orderId: 'o' },
      [EventTypes.StockCommitFailed]: { orderId: 'o', lines: [] },
      [EventTypes.ChargeRequested]: { orderId: 'o', amountCents: 100, currency: 'USD', paymentMethodId: 'pm_x' },
      [EventTypes.RefundRequested]: { orderId: 'o', reason: 'LATE_PAYMENT' },
      [EventTypes.PaymentSucceeded]: { orderId: 'o', paymentId: 'p', amountCents: 100, last4: '4242' },
      [EventTypes.PaymentFailed]: { orderId: 'o', reason: 'CARD_DECLINED', last4: '0002' },
      [EventTypes.PaymentRefunded]: { orderId: 'o', paymentId: 'p' },
    };
    for (const type of Object.values(EventTypes)) {
      expect(parseEvent(envelope(type, examples[type])).kind, type).toBe('valid');
    }
  });
});
