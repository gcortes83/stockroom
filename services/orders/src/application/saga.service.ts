import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AnyEvent, EventTypes } from '@stockroom/contracts';
import { type Transaction, writeOutbox } from '@stockroom/platform';
import { decide, type SagaSignal } from '../domain/order-saga';
import { OrderRepository } from '../infrastructure/order.repository';

export function toSignal(event: AnyEvent): SagaSignal | null {
  switch (event.type) {
    case EventTypes.StockReserved:
      return { kind: 'StockReserved' };
    case EventTypes.StockReservationFailed:
      return { kind: 'ReservationFailed', lines: event.payload.lines };
    case EventTypes.StockReservationExpired:
      return { kind: 'ReservationExpired' };
    case EventTypes.StockCommitFailed:
      return { kind: 'StockCommitFailed', lines: event.payload.lines };
    case EventTypes.PaymentSucceeded:
      return { kind: 'PaymentSucceeded', last4: event.payload.last4 };
    case EventTypes.PaymentFailed:
      return { kind: 'PaymentFailed', reason: event.payload.reason, last4: event.payload.last4 };
    case EventTypes.PaymentRefunded:
      return { kind: 'PaymentRefunded' };
    default:
      return null;
  }
}

@Injectable()
export class SagaService {
  private readonly logger = new Logger('OrderSaga');

  constructor(@Inject(OrderRepository) private readonly orders: OrderRepository) {}

  async handle(tx: Transaction, event: AnyEvent): Promise<void> {
    const signal = toSignal(event);
    if (!signal || !('orderId' in event.payload)) return;
    const orderId = event.payload.orderId;
    const order = await this.orders.lockForSaga(tx, orderId);
    if (!order) {
      this.logger.warn({ correlationId: event.correlationId, orderId }, `Event ${event.type} for unknown order`);
      return;
    }
    const base = { aggregateType: 'order', aggregateId: orderId, correlationId: event.correlationId, causationId: event.id };
    let status = order.status;
    for (const effect of decide({ status: order.status, totalCents: order.total_cents }, signal)) {
      switch (effect.type) {
        case 'transition':
          await this.orders.transition(tx, orderId, status, effect.to, effect.reason, effect.detail);
          this.logger.log({ correlationId: event.correlationId, orderId }, `Order ${status} -> ${effect.to}`);
          status = effect.to;
          break;
        case 'recordPayment':
          await this.orders.recordPayment(tx, orderId, effect.status, effect.last4, effect.declineReason);
          break;
        case 'requestCharge':
          await writeOutbox(tx, {
            ...base,
            type: EventTypes.ChargeRequested,
            payload: {
              orderId,
              amountCents: order.total_cents,
              currency: order.currency,
              paymentMethodId: order.payment_method_id,
            },
          });
          break;
        case 'emitConfirmed':
          await writeOutbox(tx, { ...base, type: EventTypes.OrderConfirmed, payload: { orderId } });
          break;
        case 'emitCancelled':
          await writeOutbox(tx, { ...base, type: EventTypes.OrderCancelled, payload: { orderId, reason: effect.reason } });
          break;
        case 'requestRefund':
          await writeOutbox(tx, { ...base, type: EventTypes.RefundRequested, payload: { orderId, reason: effect.reason } });
          break;
        case 'ignore':
          this.logger.debug({ correlationId: event.correlationId, orderId }, `Ignored ${event.type}: ${effect.note}`);
          break;
      }
    }
  }
}
