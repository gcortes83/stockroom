import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES, type Product } from '@stockroom/contracts';
import { readStorage, writeStorage } from '@/shared/lib/storage';

const KEY = 'stockroom.cart.v1';

const lineSchema = z.object({
  productId: z.string(),
  sku: z.string(),
  name: z.string(),
  categorySlug: z.string(),
  unitPriceCents: z.number().int().min(0),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  available: z.number().int().min(0),
});
const cartSchema = z.array(lineSchema).max(MAX_ORDER_LINES);

export type CartLine = z.infer<typeof lineSchema>;

const listeners = new Set<() => void>();
let lines: CartLine[] = load();

function load(): CartLine[] {
  const raw = readStorage(KEY);
  if (!raw) return [];
  try {
    const parsed = cartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function commit(next: CartLine[]): void {
  lines = next;
  writeStorage(KEY, next.length > 0 ? JSON.stringify(next) : null);
  listeners.forEach((listener) => listener());
}

const clampQuantity = (quantity: number, available: number) =>
  Math.max(1, Math.min(quantity, MAX_LINE_QUANTITY, Math.max(available, 1)));

export const cart = {
  add(product: Product, quantity = 1): 'added' | 'capped' | 'full' {
    const existing = lines.find((line) => line.productId === product.id);
    if (!existing && lines.length >= MAX_ORDER_LINES) return 'full';
    const wanted = (existing?.quantity ?? 0) + quantity;
    const next = clampQuantity(wanted, product.available);
    const line: CartLine = {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      categorySlug: product.category.slug,
      unitPriceCents: product.price.amountCents,
      quantity: next,
      available: product.available,
    };
    commit(existing ? lines.map((item) => (item.productId === product.id ? line : item)) : [...lines, line]);
    return next < wanted ? 'capped' : 'added';
  },
  setQuantity(productId: string, quantity: number): void {
    commit(lines.map((line) => (line.productId === productId ? { ...line, quantity: clampQuantity(quantity, line.available) } : line)));
  },
  remove(productId: string): void {
    commit(lines.filter((line) => line.productId !== productId));
  },
  refresh(product: Pick<Product, 'id' | 'name' | 'available' | 'price'>): void {
    commit(
      lines.map((line) =>
        line.productId === product.id
          ? { ...line, name: product.name, available: product.available, unitPriceCents: product.price.amountCents }
          : line,
      ),
    );
  },
  applyPrices(prices: { productId: string; unitPriceCents: number }[]): void {
    const byId = new Map(prices.map((price) => [price.productId, price.unitPriceCents]));
    commit(lines.map((line) => ({ ...line, unitPriceCents: byId.get(line.productId) ?? line.unitPriceCents })));
  },
  clear(): void {
    commit([]);
  },
  snapshot: () => lines,
};

export function cartTotals(items: readonly CartLine[]) {
  const subtotalCents = items.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const itemCount = items.reduce((sum, line) => sum + line.quantity, 0);
  return { subtotalCents, itemCount };
}

export function cartSignature(items: readonly CartLine[]): string {
  return items.map((line) => `${line.productId}:${line.quantity}:${line.unitPriceCents}`).join('|');
}

export function useCart(): CartLine[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => lines,
    () => lines,
  );
}
