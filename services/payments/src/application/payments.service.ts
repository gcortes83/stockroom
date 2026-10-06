import { Inject, Injectable, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import {
  createPaymentMethodSchema,
  type EventEnvelope,
  EventTypes,
  type PaymentMethod,
  type PaymentOutcome,
} from '@stockroom/contracts';
import {
  CLOCK,
  type Clock,
  DATABASE,
  type Database,
  handleOnce,
  newId,
  OutboxRelay,
  TransientError,
  ValidationError,
  writeOutbox,
} from '@stockroom/platform';
import { PAYMENTS_CONFIG, type PaymentsConfig } from '../config';
import { decideCharge, detectBrand, isExpired, newPaymentMethodId, passesLuhn, simulatedOutcome } from '../domain/card';

type MethodRow = {
  id: string;
  last4: string;
  simulated_outcome: PaymentOutcome;
  decline_reason: string | null;
  failures_remaining: number;
  expires_at: Date;
};

export const PAYMENTS_QUEUE = 'payments.commands';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
  ) {}

  async tokenize(input: z.output<typeof createPaymentMethodSchema>): Promise<PaymentMethod> {
    const now = this.clock.now();
    const errors = [];
    if (!passesLuhn(input.cardNumber)) errors.push({ path: 'cardNumber', message: 'Card number is invalid' });
    if (isExpired(input.expMonth, input.expYear, now)) errors.push({ path: 'expMonth', message: 'Card is expired' });
    if (errors.length > 0) throw new ValidationError(errors, 'The card details are invalid');
    const { outcome, declineReason } = simulatedOutcome(input.cardNumber);
    const id = newPaymentMethodId();
    const last4 = input.cardNumber.slice(-4);
    const brand = detectBrand(input.cardNumber);
    const expiresAt = new Date(now.getTime() + this.config.PAYMENT_METHOD_TTL_SECONDS * 1000);
    await this.db.query(
      `INSERT INTO payment_methods (id, brand, last4, exp_month, exp_year, holder_name, simulated_outcome, decline_reason,
         failures_remaining, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, brand, last4, input.expMonth, input.expYear, input.holderName, outcome, declineReason, outcome === 'FAIL_ONCE' ? 1 : 0, expiresAt],
    );
    return { id, brand, last4, expMonth: input.expMonth, expYear: input.expYear, expiresAt: expiresAt.toISOString() };
  }

  async charge(event: EventEnvelope<typeof EventTypes.ChargeRequested>): Promise<void> {
    const { orderId, paymentMethodId, amountCents, currency } = event.payload;
    const method = await this.findMethod(paymentMethodId);
    if (method && method.simulated_outcome === 'FAIL_ONCE' && method.failures_remaining > 0 && !(await this.hasPayment(orderId))) {
      await this.db.query('UPDATE payment_methods SET failures_remaining = failures_remaining - 1 WHERE id = $1', [method.id]);
      throw new TransientError('Simulated transient processing error');
    }
    if (this.config.PAYMENT_SIMULATED_LATENCY_MS > 0) await sleep(this.config.PAYMENT_SIMULATED_LATENCY_MS);
    const processed = await handleOnce(this.db, PAYMENTS_QUEUE, event.id, async (tx) => {
      const { rows: existing } = await tx.query<{ id: string; status: string; decline_reason: string | null; last4: string | null }>(
        'SELECT id, status, decline_reason, last4 FROM payments WHERE order_id = $1 FOR UPDATE',
        [orderId],
      );
      const base = { aggregateType: 'payment', aggregateId: orderId, correlationId: event.correlationId, causationId: event.id };
      const previous = existing[0];
      if (previous) {
        if (previous.status === 'FAILED')
          await writeOutbox(tx, {
            ...base,
            type: EventTypes.PaymentFailed,
            payload: { orderId, reason: previous.decline_reason ?? 'CARD_DECLINED', last4: previous.last4 },
          });
        else
          await writeOutbox(tx, {
            ...base,
            type: EventTypes.PaymentSucceeded,
            payload: { orderId, paymentId: previous.id, amountCents, last4: previous.last4 ?? '0000' },
          });
        return;
      }
      const decision = decideCharge(
        method ? { outcome: method.simulated_outcome, declineReason: method.decline_reason, expiresAt: method.expires_at } : null,
        amountCents,
        this.config.PAYMENT_LIMIT_CENTS,
        this.clock.now(),
      );
      const paymentId = newId();
      await tx.query(
        `INSERT INTO payments (id, order_id, payment_method_id, amount_cents, currency, status, decline_reason, last4)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          paymentId,
          orderId,
          method?.id ?? null,
          amountCents,
          currency,
          decision.status,
          decision.status === 'FAILED' ? decision.reason : null,
          method?.last4 ?? null,
        ],
      );
      if (decision.status === 'SUCCEEDED') {
        await writeOutbox(tx, {
          ...base,
          type: EventTypes.PaymentSucceeded,
          payload: { orderId, paymentId, amountCents, last4: method?.last4 ?? '0000' },
        });
      } else {
        await writeOutbox(tx, {
          ...base,
          type: EventTypes.PaymentFailed,
          payload: { orderId, reason: decision.reason, last4: method?.last4 ?? null },
        });
      }
      this.logger.log({ correlationId: event.correlationId, orderId }, `Charge ${decision.status}`);
    });
    if (processed) this.relay.notify();
  }

  async refund(event: EventEnvelope<typeof EventTypes.RefundRequested>): Promise<void> {
    const { orderId } = event.payload;
    const processed = await handleOnce(this.db, PAYMENTS_QUEUE, event.id, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE payments SET status = 'REFUNDED', updated_at = now() WHERE order_id = $1 AND status = 'SUCCEEDED' RETURNING id`,
        [orderId],
      );
      const payment = rows[0];
      if (!payment) return;
      await writeOutbox(tx, {
        type: EventTypes.PaymentRefunded,
        aggregateType: 'payment',
        aggregateId: orderId,
        payload: { orderId, paymentId: payment.id },
        correlationId: event.correlationId,
        causationId: event.id,
      });
      this.logger.log({ correlationId: event.correlationId, orderId }, `Refunded payment ${payment.id}`);
    });
    if (processed) this.relay.notify();
  }

  private async findMethod(id: string): Promise<MethodRow | null> {
    const { rows } = await this.db.query<MethodRow>(
      'SELECT id, last4, simulated_outcome, decline_reason, failures_remaining, expires_at FROM payment_methods WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  private async hasPayment(orderId: string): Promise<boolean> {
    const { rowCount } = await this.db.query('SELECT 1 FROM payments WHERE order_id = $1', [orderId]);
    return (rowCount ?? 0) > 0;
  }
}
