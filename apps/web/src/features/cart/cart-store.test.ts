import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '@stockroom/contracts';
import { cart, cartSignature, cartTotals } from './cart-store';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  sku: 'RS-001',
  name: 'Running Shoes',
  description: '',
  category: { id: 'c', name: 'Footwear', slug: 'footwear' },
  price: { amountCents: 9499, currency: 'USD' },
  stock: 3,
  reserved: 0,
  available: 3,
  weightGrams: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('cart', () => {
  beforeEach(() => cart.clear());

  it('adds products and merges quantities', () => {
    cart.add(product());
    cart.add(product(), 1);
    expect(cart.snapshot()).toHaveLength(1);
    expect(cart.snapshot()[0]?.quantity).toBe(2);
  });

  it('caps quantities at available stock', () => {
    expect(cart.add(product(), 10)).toBe('capped');
    expect(cart.snapshot()[0]?.quantity).toBe(3);
  });

  it('computes totals in integer cents', () => {
    cart.add(product({ id: 'a', price: { amountCents: 10, currency: 'USD' }, available: 99 }), 3);
    cart.add(product({ id: 'b', price: { amountCents: 20, currency: 'USD' }, available: 99 }), 1);
    expect(cartTotals(cart.snapshot())).toEqual({ subtotalCents: 50, itemCount: 4 });
  });

  it('changes its signature when prices change', () => {
    cart.add(product());
    const before = cartSignature(cart.snapshot());
    cart.applyPrices([{ productId: 'p1', unitPriceCents: 1 }]);
    expect(cartSignature(cart.snapshot())).not.toBe(before);
  });
});
