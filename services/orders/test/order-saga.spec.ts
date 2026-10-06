import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@stockroom/contracts';
import { decide, type SagaSignal } from '../src/domain/order-saga';

const kinds = (status: OrderStatus, signal: SagaSignal, totalCents = 1000) =>
  decide({ status, totalCents }, signal).map((effect) =>
    effect.type === 'transition' ? `transition:${effect.to}${effect.reason ? `:${effect.reason}` : ''}` : effect.type,
  );

const shortage = [{ productId: 'p', sku: 'S', requested: 2, available: 1 }];

describe('order saga state machine', () => {
  it('moves a paid order to awaiting payment and requests the charge', () => {
    expect(kinds('PENDING', { kind: 'StockReserved' })).toEqual(['transition:AWAITING_PAYMENT', 'requestCharge']);
  });

  it('confirms a zero-total order without payment', () => {
    expect(kinds('PENDING', { kind: 'StockReserved' }, 0)).toEqual(['transition:CONFIRMED', 'emitConfirmed']);
  });

  it('ignores duplicate reservations and releases stock for cancelled orders', () => {
    expect(kinds('AWAITING_PAYMENT', { kind: 'StockReserved' })).toEqual(['ignore']);
    expect(kinds('CONFIRMED', { kind: 'StockReserved' })).toEqual(['ignore']);
    expect(kinds('CANCELLED', { kind: 'StockReserved' })).toEqual(['emitCancelled']);
  });

  it('cancels as out of stock when the reservation fails', () => {
    expect(kinds('PENDING', { kind: 'ReservationFailed', lines: shortage })).toEqual(['transition:CANCELLED:OUT_OF_STOCK']);
    expect(kinds('CANCELLED', { kind: 'ReservationFailed', lines: shortage })).toEqual(['ignore']);
  });

  it('confirms on payment success', () => {
    expect(kinds('AWAITING_PAYMENT', { kind: 'PaymentSucceeded', last4: '4242' })).toEqual([
      'recordPayment',
      'transition:CONFIRMED',
      'emitConfirmed',
    ]);
  });

  it('refunds a payment that arrives after cancellation', () => {
    expect(kinds('CANCELLED', { kind: 'PaymentSucceeded', last4: '4242' })).toEqual(['recordPayment', 'requestRefund']);
  });

  it('ignores payment results outside the payment step', () => {
    expect(kinds('PENDING', { kind: 'PaymentSucceeded', last4: '4242' })).toEqual(['ignore']);
    expect(kinds('CONFIRMED', { kind: 'PaymentSucceeded', last4: '4242' })).toEqual(['ignore']);
    expect(kinds('PENDING', { kind: 'PaymentFailed', reason: 'CARD_DECLINED', last4: null })).toEqual(['ignore']);
  });

  it('cancels and releases stock when the payment is declined', () => {
    expect(kinds('AWAITING_PAYMENT', { kind: 'PaymentFailed', reason: 'CARD_DECLINED', last4: '0002' })).toEqual([
      'recordPayment',
      'transition:CANCELLED:PAYMENT_DECLINED',
      'emitCancelled',
    ]);
  });

  it('cancels expired orders that are not terminal', () => {
    expect(kinds('PENDING', { kind: 'ReservationExpired' })).toEqual(['transition:CANCELLED:RESERVATION_EXPIRED', 'emitCancelled']);
    expect(kinds('AWAITING_PAYMENT', { kind: 'ReservationExpired' })).toEqual([
      'transition:CANCELLED:RESERVATION_EXPIRED',
      'emitCancelled',
    ]);
    expect(kinds('CONFIRMED', { kind: 'ReservationExpired' })).toEqual(['ignore']);
  });

  it('cancels and refunds a confirmed order whose stock commit failed', () => {
    expect(kinds('CONFIRMED', { kind: 'StockCommitFailed', lines: shortage })).toEqual([
      'transition:CANCELLED:STOCK_COMMIT_FAILED',
      'emitCancelled',
      'requestRefund',
    ]);
  });

  it('records refunds in any state', () => {
    expect(kinds('CANCELLED', { kind: 'PaymentRefunded' })).toEqual(['recordPayment']);
  });
});
