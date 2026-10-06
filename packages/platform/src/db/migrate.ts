import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';

type Log = (message: string) => void;

async function connectWithRetry(pool: Pool, log: Log, attempts = 30): Promise<PoolClient> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pool.connect();
    } catch (error) {
      if (attempt >= attempts) throw error;
      log(`Database not ready (attempt ${attempt}/${attempts}), retrying`);
      await sleep(1000);
    }
  }
}

export async function runMigrations(databaseUrl: string, directory: string, log: Log = () => undefined): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await connectWithRetry(pool, log);
  const appliedNow: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('schema_migrations'))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((row) => row.version),
    );
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(directory, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedNow.push(file);
        log(`Applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('schema_migrations'))").catch(() => undefined);
    client.release();
    await pool.end();
  }
  return appliedNow;
}
