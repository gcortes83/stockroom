import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_CURRENCY,
  EventTypes,
  type Order,
  type OrderStatus,
  type OrderSummary,
  pageMeta,
  type Paginated,
  type PlaceOrder,
} from '@stockroom/contracts';
import { DATABASE, type Database, isUniqueViolation, newId, OutboxRelay, writeOutbox } from '@stockroom/platform';
import {
  idempotencyKeyReused,
  insufficientStock,
  orderNotFound,
  priceChanged,
  productUnavailable,
} from '../domain/errors';
import { CATALOG_PORT, type CatalogPort } from '../infrastructure/catalog.client';
import { OrderRepository } from '../infrastructure/order.repository';

export type PlaceOrderResult = { order: Order; replayed: boolean };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const hashRequest = (body: unknown): string => createHash('sha256').update(canonicalJson(body)).digest('hex');

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(CATALOG_PORT) private readonly catalog: CatalogPort,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
  ) {}

  async place(input: PlaceOrder, idempotencyKey: string, correlationId: string): Promise<PlaceOrderResult> {
    const requestHash = hashRequest(input);
    const existing = await this.replay(idempotencyKey, requestHash);
    if (existing) return existing;

    const snapshots = await this.catalog.snapshot(
      input.lines.map((line) => line.productId),
      correlationId,
    );
    const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    const unavailable = input.lines.filter((line) => !byId.get(line.productId)?.active).map((line) => line.productId);
    if (unavailable.length > 0) throw productUnavailable(unavailable);

    const lines = input.lines.map((line) => {
      const snapshot = byId.get(line.productId);
      if (!snapshot) throw productUnavailable([line.productId]);
      return { productId: line.productId, sku: snapshot.sku, name: snapshot.name, unitPriceCents: snapshot.priceCents, quantity: line.quantity, available: snapshot.available };
    });
    const shortages = lines
      .filter((line) => line.available < line.quantity)
      .map((line) => ({ productId: line.productId, sku: line.sku, requested: line.quantity, available: line.available }));
    if (shortages.length > 0) throw insufficientStock(shortages);

    const totalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
    if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== totalCents) {
      throw priceChanged(
        lines.map((line) => ({ productId: line.productId, sku: line.sku, unitPriceCents: line.unitPriceCents })),
        totalCents,
      );
    }

    const id = newId();
    try {
      await this.db.transaction(async (tx) => {
        await this.orders.insert(tx, {
          id,
          customerName: input.customer.name,
          customerEmail: input.customer.email,
          currency: DEFAULT_CURRENCY,
          totalCents,
          paymentMethodId: input.paymentMethodId,
          idempotencyKey,
          requestHash,
          correlationId,
          lines,
        });
        await writeOutbox(tx, {
          type: EventTypes.OrderCreated,
          aggregateType: 'order',
          aggregateId: id,
          payload: { orderId: id, lines: lines.map((line) => ({ productId: line.productId, sku: line.sku, quantity: line.quantity })) },
          correlationId,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'orders_idempotency_key_key')) {
        const replayed = await this.replay(idempotencyKey, requestHash);
        if (replayed) return replayed;
      }
      throw error;
    }
    this.relay.notify();
    return { order: await this.get(id), replayed: false };
  }

  private async replay(idempotencyKey: string, requestHash: string): Promise<PlaceOrderResult | null> {
    const existing = await this.orders.findByIdempotencyKey(idempotencyKey);
    if (!existing) return null;
    if (existing.request_hash !== requestHash) throw idempotencyKeyReused();
    return { order: await this.get(existing.id), replayed: true };
  }

  async get(id: string): Promise<Order> {
    const order = await this.orders.findById(id);
    if (!order) throw orderNotFound(id);
    return order;
  }

  async list(status: OrderStatus | undefined, page: number, pageSize: number): Promise<Paginated<OrderSummary>> {
    const { items, total } = await this.orders.list(status, page, pageSize);
    return { data: items, page: pageMeta(page, pageSize, total) };
  }
}
