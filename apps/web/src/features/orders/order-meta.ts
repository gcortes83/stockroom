import type { Order, OrderStatus } from '@stockroom/contracts';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Received',
  AWAITING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE: Record<OrderStatus, 'info' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'info',
  AWAITING_PAYMENT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
};

const DECLINES: Record<string, string> = {
  CARD_DECLINED: 'The card was declined by the issuer.',
  INSUFFICIENT_FUNDS: 'The card has insufficient funds.',
  LIMIT_EXCEEDED: 'The amount exceeds the payment limit of $10,000.',
  INVALID_PAYMENT_METHOD: 'The payment method expired or is invalid. Please re-enter your card.',
};

type Shortage = { sku: string; requested: number; available: number };

export function cancellationMessage(order: Order): string | null {
  if (!order.cancellation) return null;
  const detail = (order.cancellation.detail ?? {}) as { lines?: Shortage[]; reason?: string };
  switch (order.cancellation.reason) {
    case 'OUT_OF_STOCK': {
      const lines = detail.lines ?? [];
      return lines.length > 0
        ? `Not enough stock: ${lines.map((line) => `${line.sku} (wanted ${line.requested}, ${line.available} left)`).join(', ')}.`
        : 'Some items sold out before we could reserve them.';
    }
    case 'PAYMENT_DECLINED':
      return DECLINES[order.payment?.declineReason ?? detail.reason ?? ''] ?? 'The payment was declined.';
    case 'RESERVATION_EXPIRED':
      return 'Payment took too long, so the reserved stock was released. You have not been charged.';
    case 'STOCK_COMMIT_FAILED':
      return 'The items sold out while the payment was processing. Your payment is being refunded.';
  }
}

export type PipelineStep = { key: string; title: string; caption: string; state: 'done' | 'active' | 'pending' | 'failed' | 'skipped' };

export function pipeline(order: Order): PipelineStep[] {
  const reached = new Set(order.history.map((entry) => entry.to));
  const status = order.status;
  const reason = order.cancellation?.reason;
  const reserved = reached.has('AWAITING_PAYMENT') || (status === 'CONFIRMED' && !reached.has('AWAITING_PAYMENT'));
  const zeroTotal = order.total.amountCents === 0;
  const reserveState: PipelineStep['state'] =
    reason === 'OUT_OF_STOCK' ? 'failed' : reserved || status === 'CONFIRMED' ? 'done' : status === 'CANCELLED' ? 'failed' : 'active';
  const paymentState: PipelineStep['state'] = zeroTotal
    ? 'skipped'
    : order.payment?.status === 'SUCCEEDED' || order.payment?.status === 'REFUNDED'
      ? 'done'
      : reason === 'PAYMENT_DECLINED' || reason === 'RESERVATION_EXPIRED'
        ? 'failed'
        : status === 'AWAITING_PAYMENT'
          ? 'active'
          : status === 'CANCELLED'
            ? 'skipped'
            : 'pending';
  const finalState: PipelineStep['state'] = status === 'CONFIRMED' ? 'done' : status === 'CANCELLED' ? 'failed' : 'pending';
  return [
    { key: 'received', title: 'Order received', caption: 'Validated prices and created your order', state: 'done' },
    { key: 'reserve', title: 'Reserving stock', caption: 'Holding your items so nobody else can take them', state: reserveState },
    {
      key: 'payment',
      title: 'Processing payment',
      caption: zeroTotal ? 'Nothing to charge for a free order' : 'Talking to the (simulated) payment provider',
      state: paymentState,
    },
    {
      key: 'final',
      title: status === 'CANCELLED' ? 'Order cancelled' : 'Confirmed',
      caption: status === 'CANCELLED' ? 'Reserved stock was released' : 'Stock committed and order confirmed',
      state: finalState,
    },
  ];
}
