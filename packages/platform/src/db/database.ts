import { Pool, type PoolClient, type QueryResult, type QueryResultRow, types } from 'pg';

types.setTypeParser(20, (value) => Number(value));

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

export type Transaction = PoolClient;

export class Database implements Queryable {
  constructor(readonly pool: Pool) {}

  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type SessionSettings = Record<string, string | number>;

export function createDatabase(connectionString: string, max = 10, sessionSettings: SessionSettings = {}): Database {
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
  const statements = Object.entries(sessionSettings).map(([name, value]) => {
    if (!/^[a-z_][a-z0-9_.]*$/i.test(name)) throw new Error(`Invalid session setting name: ${name}`);
    return `SET ${name} = '${String(value).replace(/'/g, "''")}'`;
  });
  if (statements.length > 0) {
    pool.on('connect', (client) => {
      for (const statement of statements) void client.query(statement);
    });
  }
  return new Database(pool);
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && (constraint === undefined || pgError.constraint === constraint);
}

export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isoRequired(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
