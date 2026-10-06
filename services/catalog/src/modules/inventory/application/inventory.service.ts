import { Inject, Injectable } from '@nestjs/common';
import { type EventEnvelope, EventTypes } from '@stockroom/contracts';
import { CLOCK, type Clock, DATABASE, type Database, newId, type Transaction, writeOutbox } from '@stockroom/platform';
import { CATALOG_CONFIG, type CatalogConfig } from '../../../config';

type Shortage = { productId: string; sku: string; requested: number; available: number };

type ReservationRow = {
  id: string;
  product_id: string;
  sku: string;
  quantity: number;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
};

const SWEEP_LOCK_KEY = 727_002;

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CATALOG_CONFIG) private readonly config: CatalogConfig,
  ) {}

  async reserve(tx: Transaction, event: EventEnvelope<typeof EventTypes.OrderCreated>): Promise<'reserved' | 'failed'> {
    const { orderId } = event.payload;
    const existing = await tx.query('SELECT 1 FROM stock_reservations WHERE order_id = $1 LIMIT 1', [orderId]);
    if ((existing.rowCount ?? 0) > 0) return 'reserved';
    const lines = [...event.payload.lines].sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const ids = lines.map((line) => line.productId);
    await tx.query('SAVEPOINT reserve_stock');
    await tx.query('SELECT id FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    let reservedAll = true;
    for (const line of lines) {
      const result = await tx.query(
        `UPDATE products SET reserved = reserved + $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL AND stock - reserved >= $2`,
        [line.productId, line.quantity],
      );
      if (result.rowCount !== 1) {
        reservedAll = false;
        break;
      }
    }
    if (!reservedAll) {
      await tx.query('ROLLBACK TO SAVEPOINT reserve_stock');
      const shortages = await this.shortages(tx, lines);
      await writeOutbox(tx, {
        type: EventTypes.StockReservationFailed,
        aggregateType: 'order',
        aggregateId: orderId,
        payload: { orderId, lines: shortages },
        correlationId: event.correlationId,
        causationId: event.id,
      });
      return 'failed';
    }
    await tx.query('RELEASE SAVEPOINT reserve_stock');
    const expiresAt = new Date(this.clock.now().getTime() + this.config.RESERVATION_TTL_SECONDS * 1000);
    await tx.query(
      `INSERT INTO stock_reservations (id, order_id, product_id, quantity, status, expires_at, correlation_id)
       SELECT unnest($1::uuid[]), $2, unnest($3::uuid[]), unnest($4::int[]), 'RESERVED', $5, $6`,
      [lines.map(() => newId()), orderId, ids, lines.map((line) => line.quantity), expiresAt, event.correlationId],
    );
    await writeOutbox(tx, {
      type: EventTypes.StockReserved,
      aggregateType: 'order',
      aggregateId: orderId,
      payload: { orderId, expiresAt: expiresAt.toISOString() },
      correlationId: event.correlationId,
      causationId: event.id,
    });
    return 'reserved';
  }

  async commit(tx: Transaction, event: EventEnvelope<typeof EventTypes.OrderConfirmed>): Promise<'committed' | 'failed' | 'noop'> {
    const { orderId } = event.payload;
    const reservations = await this.lockReservations(tx, orderId);
    const pending = reservations.filter((row) => row.status === 'RESERVED' || row.status === 'EXPIRED');
    if (pending.length === 0) return 'noop';
    await tx.query('SAVEPOINT commit_stock');
    let committedAll = true;
    for (const row of pending) {
      const result =
        row.status === 'RESERVED'
          ? await tx.query(
              `UPDATE products SET stock = stock - $2, reserved = reserved - $2, version = version + 1, updated_at = now()
               WHERE id = $1`,
              [row.product_id, row.quantity],
            )
          : await tx.query(
              `UPDATE products SET stock = stock - $2, version = version + 1, updated_at = now()
               WHERE id = $1 AND stock - reserved >= $2`,
              [row.product_id, row.quantity],
            );
      if (result.rowCount !== 1) {
        committedAll = false;
        break;
      }
    }
    if (!committedAll) {
      await tx.query('ROLLBACK TO SAVEPOINT commit_stock');
      const shortages = await this.shortages(
        tx,
        pending.map((row) => ({ productId: row.product_id, sku: row.sku, quantity: row.quantity })),
      );
      await writeOutbox(tx, {
        type: EventTypes.StockCommitFailed,
        aggregateType: 'order',
        aggregateId: orderId,
        payload: { orderId, lines: shortages },
        correlationId: event.correlationId,
        causationId: event.id,
      });
      return 'failed';
    }
    await tx.query('RELEASE SAVEPOINT commit_stock');
    await tx.query(
      `UPDATE stock_reservations SET status = 'COMMITTED', updated_at = now() WHERE id = ANY($1::uuid[])`,
      [pending.map((row) => row.id)],
    );
    return 'committed';
  }

  async release(tx: Transaction, event: EventEnvelope<typeof EventTypes.OrderCancelled>): Promise<number> {
    const reservations = (await this.lockReservations(tx, event.payload.orderId)).filter((row) => row.status === 'RESERVED');
    for (const row of reservations) {
      await tx.query(
        'UPDATE products SET reserved = reserved - $2, version = version + 1, updated_at = now() WHERE id = $1',
        [row.product_id, row.quantity],
      );
    }
    if (reservations.length > 0) {
      await tx.query(`UPDATE stock_reservations SET status = 'RELEASED', updated_at = now() WHERE id = ANY($1::uuid[])`, [
        reservations.map((row) => row.id),
      ]);
    }
    return reservations.length;
  }

  async sweepExpired(limit = 200): Promise<number> {
    return this.db.transaction(async (tx) => {
      const { rows: lock } = await tx.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        SWEEP_LOCK_KEY,
      ]);
      if (!lock[0]?.locked) return 0;
      const { rows } = await tx.query<{
        id: string;
        order_id: string;
        product_id: string;
        quantity: number;
        correlation_id: string;
      }>(
        `SELECT id, order_id, product_id, quantity, correlation_id FROM stock_reservations
         WHERE status = 'RESERVED' AND expires_at < $1
         ORDER BY product_id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [this.clock.now(), limit],
      );
      if (rows.length === 0) return 0;
      for (const row of rows) {
        await tx.query(
          'UPDATE products SET reserved = reserved - $2, version = version + 1, updated_at = now() WHERE id = $1',
          [row.product_id, row.quantity],
        );
      }
      await tx.query(`UPDATE stock_reservations SET status = 'EXPIRED', updated_at = now() WHERE id = ANY($1::uuid[])`, [
        rows.map((row) => row.id),
      ]);
      const orders = new Map(rows.map((row) => [row.order_id, row.correlation_id]));
      for (const [orderId, correlationId] of orders) {
        await writeOutbox(tx, {
          type: EventTypes.StockReservationExpired,
          aggregateType: 'order',
          aggregateId: orderId,
          payload: { orderId },
          correlationId,
        });
      }
      return orders.size;
    });
  }

  private async lockReservations(tx: Transaction, orderId: string): Promise<ReservationRow[]> {
    const { rows } = await tx.query<ReservationRow>(
      `SELECT r.id, r.product_id, p.sku, r.quantity, r.status FROM stock_reservations r
       JOIN products p ON p.id = r.product_id
       WHERE r.order_id = $1 ORDER BY r.product_id FOR UPDATE OF r`,
      [orderId],
    );
    return rows;
  }

  private async shortages(
    tx: Transaction,
    lines: readonly { productId: string; sku: string; quantity: number }[],
  ): Promise<Shortage[]> {
    const { rows } = await tx.query<{ id: string; available: number }>(
      `SELECT id, CASE WHEN deleted_at IS NULL THEN stock - reserved ELSE 0 END AS available
       FROM products WHERE id = ANY($1::uuid[])`,
      [lines.map((line) => line.productId)],
    );
    const available = new Map(rows.map((row) => [row.id, row.available]));
    return lines
      .map((line) => ({
        productId: line.productId,
        sku: line.sku,
        requested: line.quantity,
        available: available.get(line.productId) ?? 0,
      }))
      .filter((line) => line.available < line.requested);
  }
}
