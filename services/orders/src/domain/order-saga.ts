import type { CancelReason, OrderStatus } from '@stockroom/contracts';

export type Shortage = { productId: string; sku: string; requested: number; available: number };

export type SagaSignal =
  | { kind: 'StockReserved' }
  | { kind: 'ReservationFailed'; lines: Shortage[] }
  | { kind: 'ReservationExpired' }
  | { kind: 'StockCommitFailed'; lines: Shortage[] }
  | { kind: 'PaymentSucceeded'; last4: string }
  | { kind: 'PaymentFailed'; reason: string; last4: string | null }
  | { kind: 'PaymentRefunded' };

export type SagaEffect =
  | { type: 'transition'; to: OrderStatus; reason: CancelReason | null; detail: unknown }
  | { type: 'recordPayment'; status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED'; last4: string | null; declineReason: string | null }
  | { type: 'requestCharge' }
  | { type: 'emitConfirmed' }
  | { type: 'emitCancelled'; reason: string }
  | { type: 'requestRefund'; reason: string }
  | { type: 'ignore'; note: string };

export type SagaState = { status: OrderStatus; totalCents: number };

const ignore = (note: string): SagaEffect[] => [{ type: 'ignore', note }];

const cancel = (reason: CancelReason, detail: unknown = null): SagaEffect[] => [
  { type: 'transition', to: 'CANCELLED', reason, detail },
  { type: 'emitCancelled', reason },
];

export function decide(state: SagaState, signal: SagaSignal): SagaEffect[] {
  const { status } = state;
  switch (signal.kind) {
    case 'StockReserved':
      if (status === 'PENDING') {
        return state.totalCents === 0
          ? [{ type: 'transition', to: 'CONFIRMED', reason: null, detail: null }, { type: 'emitConfirmed' }]
          : [{ type: 'transition', to: 'AWAITING_PAYMENT', reason: null, detail: null }, { type: 'requestCharge' }];
      }
      if (status === 'CANCELLED') return [{ type: 'emitCancelled', reason: 'ALREADY_CANCELLED' }];
      return ignore('duplicate stock reservation');
    case 'ReservationFailed':
      if (status === 'PENDING')
        return [{ type: 'transition', to: 'CANCELLED', reason: 'OUT_OF_STOCK', detail: { lines: signal.lines } }];
      return ignore('reservation failure after the order moved on');
    case 'ReservationExpired':
      if (status === 'PENDING' || status === 'AWAITING_PAYMENT') return cancel('RESERVATION_EXPIRED');
      return ignore('reservation expired after a terminal state');
    case 'PaymentSucceeded':
      if (status === 'AWAITING_PAYMENT')
        return [
          { type: 'recordPayment', status: 'SUCCEEDED', last4: signal.last4, declineReason: null },
          { type: 'transition', to: 'CONFIRMED', reason: null, detail: null },
          { type: 'emitConfirmed' },
        ];
      if (status === 'CANCELLED')
        return [
          { type: 'recordPayment', status: 'SUCCEEDED', last4: signal.last4, declineReason: null },
          { type: 'requestRefund', reason: 'PAYMENT_AFTER_CANCELLATION' },
        ];
      return ignore(status === 'PENDING' ? 'payment before stock reservation' : 'duplicate payment success');
    case 'PaymentFailed':
      if (status === 'AWAITING_PAYMENT')
        return [
          { type: 'recordPayment', status: 'FAILED', last4: signal.last4, declineReason: signal.reason },
          ...cancel('PAYMENT_DECLINED', { reason: signal.reason }),
        ];
      return ignore('payment failure outside the payment step');
    case 'StockCommitFailed':
      if (status === 'CONFIRMED')
        return [...cancel('STOCK_COMMIT_FAILED', { lines: signal.lines }), { type: 'requestRefund', reason: 'STOCK_COMMIT_FAILED' }];
      return ignore('commit failure for a non-confirmed order');
    case 'PaymentRefunded':
      return [{ type: 'recordPayment', status: 'REFUNDED', last4: null, declineReason: null }];
  }
}
