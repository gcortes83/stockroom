import { Inject, Injectable } from '@nestjs/common';
import type { CancelReason, Order, OrderStatus, OrderSummary } from '@stockroom/contracts';
import { DATABASE, type Database, isoRequired, newId, type Queryable } from '@stockroom/platform';

export type NewOrder = {
  id: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  totalCents: number;
  paymentMethodId: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  lines: { productId: string; sku: string; name: string; unitPriceCents: number; quantity: number }[];
};

export type SagaOrder = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  currency: string;
  payment_method_id: string;
  correlation_id: string;
};

type OrderRow = {
  id: string;
  status: OrderStatus;
  customer_name: string;
  customer_email: string;
  currency: string;
  total_cents: number;
  payment_status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | null;
  payment_last4: string | null;
  payment_decline_reason: string | null;
  cancel_reason: CancelReason | null;
  cancel_detail: unknown;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class OrderRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insert(tx: Queryable, order: NewOrder): Promise<void> {
    await tx.query(
      `INSERT INTO orders (id, status, customer_name, customer_email, currency, total_cents, payment_method_id,
         idempotency_key, request_hash, correlation_id)
       VALUES ($1, 'PENDING', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        order.id,
        order.customerName,
        order.customerEmail,
        order.currency,
        order.totalCents,
        order.paymentMethodId,
        order.idempotencyKey,
        order.requestHash,
        order.correlationId,
      ],
    );
    await tx.query(
      `INSERT INTO order_lines (id, order_id, product_id, sku, name, unit_price_cents, quantity, line_total_cents, position)
       SELECT unnest($1::uuid[]), $2, unnest($3::uuid[]), unnest($4::text[]), unnest($5::text[]), unnest($6::bigint[]),
              unnest($7::int[]), unnest($8::bigint[]), unnest($9::int[])`,
      [
        order.lines.map(() => newId()),
        order.id,
        order.lines.map((line) => line.productId),
        order.lines.map((line) => line.sku),
        order.lines.map((line) => line.name),
        order.lines.map((line) => line.unitPriceCents),
        order.lines.map((line) => line.quantity),
        order.lines.map((line) => line.unitPriceCents * line.quantity),
        order.lines.map((_, index) => index),
      ],
    );
    await this.addHistory(tx, order.id, null, 'PENDING', null);
  }

  async findByIdempotencyKey(key: string): Promise<{ id: string; request_hash: string } | null> {
    const { rows } = await this.db.query<{ id: string; request_hash: string }>(
      'SELECT id, request_hash FROM orders WHERE idempotency_key = $1',
      [key],
    );
    return rows[0] ?? null;
  }

  async lockForSaga(tx: Queryable, id: string): Promise<SagaOrder | null> {
    const { rows } = await tx.query<SagaOrder>(
      `SELECT id, status, total_cents, currency, payment_method_id, correlation_id FROM orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  }

  async transition(
    tx: Queryable,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    reason: CancelReason | null,
    detail: unknown,
  ): Promise<void> {
    await tx.query(
      `UPDATE orders SET status = $2, cancel_reason = COALESCE($3, cancel_reason),
         cancel_detail = COALESCE($4::jsonb, cancel_detail), version = version + 1, updated_at = now()
       WHERE id = $1`,
      [id, to, reason, detail === null ? null : JSON.stringify(detail)],
    );
    await this.addHistory(tx, id, from, to, reason);
  }

  async recordPayment(
    tx: Queryable,
    id: string,
    status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED',
    last4: string | null,
    declineReason: string | null,
  ): Promise<void> {
    await tx.query(
      `UPDATE orders SET payment_status = $2, payment_last4 = COALESCE($3, payment_last4),
         payment_decline_reason = $4, updated_at = now()
       WHERE id = $1`,
      [id, status, last4, declineReason],
    );
  }

  private async addHistory(
    tx: Queryable,
    orderId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    reason: string | null,
  ): Promise<void> {
    await tx.query(
      'INSERT INTO order_status_history (id, order_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4, $5)',
      [newId(), orderId, from, to, reason],
    );
  }

  async findById(id: string, db: Queryable = this.db): Promise<Order | null> {
    const { rows } = await db.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
    const row = rows[0];
    if (!row) return null;
    const { rows: lines } = await db.query<{
      product_id: string;
      sku: string;
      name: string;
      unit_price_cents: number;
      quantity: number;
      line_total_cents: number;
    }>('SELECT * FROM order_lines WHERE order_id = $1 ORDER BY position', [id]);
    const { rows: history } = await db.query<{
      from_status: OrderStatus | null;
      to_status: OrderStatus;
      reason: string | null;
      occurred_at: Date;
    }>('SELECT from_status, to_status, reason, occurred_at FROM order_status_history WHERE order_id = $1 ORDER BY occurred_at, id', [id]);
    const money = (amountCents: number) => ({ amountCents, currency: row.currency });
    return {
      id: row.id,
      status: row.status,
      customer: { name: row.customer_name, email: row.customer_email },
      lines: lines.map((line) => ({
        productId: line.product_id,
        sku: line.sku,
        name: line.name,
        unitPrice: money(line.unit_price_cents),
        quantity: line.quantity,
        lineTotal: money(line.line_total_cents),
      })),
      total: money(row.total_cents),
      payment: row.payment_status
        ? { status: row.payment_status, last4: row.payment_last4, declineReason: row.payment_decline_reason }
        : null,
      cancellation: row.cancel_reason ? { reason: row.cancel_reason, detail: row.cancel_detail ?? null } : null,
      history: history.map((entry) => ({
        from: entry.from_status,
        to: entry.to_status,
        reason: entry.reason,
        at: isoRequired(entry.occurred_at),
      })),
      createdAt: isoRequired(row.created_at),
      updatedAt: isoRequired(row.updated_at),
    };
  }

  async list(status: OrderStatus | undefined, page: number, pageSize: number): Promise<{ items: OrderSummary[]; total: number }> {
    const { rows } = await this.db.query<{
      id: string;
      status: OrderStatus;
      total_cents: number;
      currency: string;
      customer_email: string;
      line_count: number;
      created_at: Date;
      total_items: number;
    }>(
      `SELECT o.id, o.status, o.total_cents, o.currency, o.customer_email, o.created_at,
         (SELECT count(*)::int FROM order_lines l WHERE l.order_id = o.id) AS line_count,
         count(*) OVER () AS total_items
       FROM orders o WHERE ($1::order_status IS NULL OR o.status = $1)
       ORDER BY o.created_at DESC, o.id DESC LIMIT $2 OFFSET $3`,
      [status ?? null, pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        total: { amountCents: row.total_cents, currency: row.currency },
        customerEmail: row.customer_email,
        lineCount: row.line_count,
        createdAt: isoRequired(row.created_at),
      })),
      total: rows[0]?.total_items ?? 0,
    };
  }
}
