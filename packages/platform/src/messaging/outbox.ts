import { Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import type { EventEnvelope, EventPayload, EventType, Producer } from '@stockroom/contracts';
import type { Database, Queryable } from '../db/database';
import { newId } from '../ids';
import { captureTraceContext, withProducerSpan } from '../trace-context';
import type { Broker } from './broker';

export type OutboxEvent<T extends EventType> = {
  type: T;
  aggregateType: string;
  aggregateId: string;
  payload: EventPayload<T>;
  correlationId: string;
  causationId?: string | null;
};

export async function writeOutbox<T extends EventType>(tx: Queryable, event: OutboxEvent<T>): Promise<string> {
  const id = newId();
  await tx.query(
    `INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload, correlation_id, causation_id, trace_context, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())`,
    [
      id,
      event.aggregateType,
      event.aggregateId,
      event.type,
      JSON.stringify(event.payload),
      event.correlationId,
      event.causationId ?? null,
      captureTraceContext(),
    ],
  );
  return id;
}

type OutboxRow = {
  id: string;
  type: EventType;
  payload: unknown;
  correlation_id: string;
  causation_id: string | null;
  trace_context: Record<string, string> | null;
  occurred_at: Date;
};

export class OutboxRelay {
  private readonly logger = new Logger('OutboxRelay');
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private pending = false;

  constructor(
    private readonly db: Database,
    private readonly broker: Broker,
    private readonly producer: Producer,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  notify(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    void this.tick();
  }

  async tick(): Promise<number> {
    if (this.running || this.stopped || !this.broker.isConnected()) return 0;
    this.running = true;
    try {
      const published = await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<OutboxRow>(
          `SELECT id, type, payload, correlation_id, causation_id, trace_context, occurred_at
           FROM outbox WHERE published_at IS NULL
           ORDER BY occurred_at, id LIMIT 100 FOR UPDATE SKIP LOCKED`,
        );
        let count = 0;
        for (const row of rows) {
          const envelope = {
            id: row.id,
            type: row.type,
            occurredAt: row.occurred_at.toISOString(),
            correlationId: row.correlation_id,
            causationId: row.causation_id,
            producer: this.producer,
            payload: row.payload,
          } as EventEnvelope;
          try {
            await withProducerSpan(
              row.trace_context,
              `${row.type} publish`,
              { 'messaging.system': 'rabbitmq', 'messaging.destination.name': row.type, 'messaging.message.id': row.id },
              (headers) => this.broker.publish(envelope, headers),
            );
            await tx.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
            count++;
          } catch (error) {
            await tx.query('UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [
              row.id,
              (error as Error).message.slice(0, 1000),
            ]);
            this.logger.warn(`Publishing ${row.type} failed: ${(error as Error).message}`);
            break;
          }
        }
        return count;
      });
      return published;
    } catch (error) {
      this.logger.warn(`Outbox relay tick failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
      if (this.pending && !this.stopped) {
        this.pending = false;
        setImmediate(() => void this.tick());
      }
    }
  }

  async backlog(olderThanSeconds = 60): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM outbox
       WHERE published_at IS NULL AND occurred_at < now() - make_interval(secs => $1)`,
      [olderThanSeconds],
    );
    return rows[0]?.count ?? 0;
  }

  async stop(timeoutMs = 5000): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) await sleep(25);
  }
}
