import { z } from 'zod';

export const EventTypes = {
  OrderCreated: 'orders.order.created.v1',
  OrderConfirmed: 'orders.order.confirmed.v1',
  OrderCancelled: 'orders.order.cancelled.v1',
  StockReserved: 'catalog.stock.reserved.v1',
  StockReservationFailed: 'catalog.stock.reservation-failed.v1',
  StockReservationExpired: 'catalog.stock.reservation-expired.v1',
  StockCommitFailed: 'catalog.stock.commit-failed.v1',
  ChargeRequested: 'payments.charge.requested.v1',
  RefundRequested: 'payments.refund.requested.v1',
  PaymentSucceeded: 'payments.payment.succeeded.v1',
  PaymentFailed: 'payments.payment.failed.v1',
  PaymentRefunded: 'payments.payment.refunded.v1',
} as const;

const stockShortage = z.object({
  productId: z.string(),
  sku: z.string(),
  requested: z.number().int(),
  available: z.number().int(),
});

export const eventPayloadSchemas = {
  [EventTypes.OrderCreated]: z.object({
    orderId: z.string(),
    lines: z.array(z.object({ productId: z.string(), sku: z.string(), quantity: z.number().int().positive() })).min(1),
  }),
  [EventTypes.OrderConfirmed]: z.object({ orderId: z.string() }),
  [EventTypes.OrderCancelled]: z.object({ orderId: z.string(), reason: z.string() }),
  [EventTypes.StockReserved]: z.object({ orderId: z.string(), expiresAt: z.string() }),
  [EventTypes.StockReservationFailed]: z.object({ orderId: z.string(), lines: z.array(stockShortage) }),
  [EventTypes.StockReservationExpired]: z.object({ orderId: z.string() }),
  [EventTypes.StockCommitFailed]: z.object({ orderId: z.string(), lines: z.array(stockShortage) }),
  [EventTypes.ChargeRequested]: z.object({
    orderId: z.string(),
    amountCents: z.number().int().min(0),
    currency: z.string().length(3),
    paymentMethodId: z.string(),
  }),
  [EventTypes.RefundRequested]: z.object({ orderId: z.string(), reason: z.string() }),
  [EventTypes.PaymentSucceeded]: z.object({
    orderId: z.string(),
    paymentId: z.string(),
    amountCents: z.number().int(),
    last4: z.string(),
  }),
  [EventTypes.PaymentFailed]: z.object({ orderId: z.string(), reason: z.string(), last4: z.string().nullable() }),
  [EventTypes.PaymentRefunded]: z.object({ orderId: z.string(), paymentId: z.string() }),
} as const;

export type EventType = keyof typeof eventPayloadSchemas;
export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;
export type Producer = 'catalog' | 'orders' | 'payments';

export type EventEnvelope<T extends EventType = EventType> = {
  id: string;
  type: T;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  producer: Producer;
  payload: EventPayload<T>;
};

export type AnyEvent = { [K in EventType]: EventEnvelope<K> }[EventType];

const envelopeSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  occurredAt: z.string(),
  correlationId: z.string().min(1).max(128),
  causationId: z.string().nullable(),
  producer: z.enum(['catalog', 'orders', 'payments']),
  payload: z.unknown(),
});

export type ParsedEvent =
  | { kind: 'valid'; event: AnyEvent }
  | { kind: 'unknown-type'; type: string }
  | { kind: 'invalid'; reason: string };

export function isEventType(type: string): type is EventType {
  return Object.prototype.hasOwnProperty.call(eventPayloadSchemas, type);
}

export function parseEvent(raw: unknown): ParsedEvent {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return { kind: 'invalid', reason: envelope.error.message };
  const { type } = envelope.data;
  if (!isEventType(type)) return { kind: 'unknown-type', type };
  const payload = eventPayloadSchemas[type].safeParse(envelope.data.payload);
  if (!payload.success) return { kind: 'invalid', reason: payload.error.message };
  return { kind: 'valid', event: { ...envelope.data, type, payload: payload.data } as AnyEvent };
}
