import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase } from '@stockroom/platform';

export type CatalogPostgres = { container: StartedPostgreSqlContainer; url: string };

export async function startCatalogPostgres(): Promise<CatalogPostgres> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const admin = createDatabase(container.getConnectionUri(), 1);
  await admin.query("CREATE ROLE catalog LOGIN PASSWORD 'catalog'");
  await admin.query('CREATE DATABASE catalog_db OWNER catalog');
  await admin.query('REVOKE CONNECT ON DATABASE catalog_db FROM PUBLIC');
  await admin.close();
  const url = `postgresql://catalog:catalog@${container.getHost()}:${container.getPort()}/catalog_db`;
  return { container, url };
}
