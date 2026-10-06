import { Inject, Injectable } from '@nestjs/common';
import {
  type Category,
  DEFAULT_CURRENCY,
  type Product,
  type ProductListQuery,
  type ProductSnapshot,
  type SearchMatch,
  slugify,
} from '@stockroom/contracts';
import { DATABASE, type Database, isoRequired, newId, type Queryable } from '@stockroom/platform';

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  price_cents: number;
  currency: string;
  stock: number;
  reserved: number;
  weight_grams: number | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

export const PRODUCT_COLUMNS = `p.id, p.sku, p.name, p.description, p.category_id, c.name::text AS category_name,
  c.slug AS category_slug, p.price_cents, p.currency, p.stock, p.reserved, p.weight_grams, p.version,
  p.created_at, p.updated_at`;

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    price: { amountCents: row.price_cents, currency: row.currency },
    stock: row.stock,
    reserved: row.reserved,
    available: row.stock - row.reserved,
    weightGrams: row.weight_grams,
    version: row.version,
    createdAt: isoRequired(row.created_at),
    updatedAt: isoRequired(row.updated_at),
  };
}

export function searchTokens(q: string): string[] {
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return [...new Set(tokens)].slice(0, 6);
}

export type ProductWrite = {
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  stock: number;
  weightGrams: number | null;
};

const SORT_SQL: Record<string, string> = {
  relevance: 'score DESC, p.created_at DESC',
  price_asc: 'p.price_cents ASC',
  price_desc: 'p.price_cents DESC',
  name_asc: 'p.name ASC',
  newest: 'p.created_at DESC',
};

@Injectable()
export class ProductRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async ensureCategories(tx: Queryable, names: string[]): Promise<Map<string, string>> {
    const unique = new Map<string, string>();
    for (const name of names) if (!unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
    const display = [...unique.values()];
    if (display.length === 0) return new Map();
    await tx.query(
      `INSERT INTO categories (id, name, slug)
       SELECT * FROM unnest($1::uuid[], $2::citext[], $3::text[]) ON CONFLICT DO NOTHING`,
      [display.map(() => newId()), display, display.map(slugify)],
    );
    const { rows } = await tx.query<{ id: string; name: string; slug: string }>(
      'SELECT id, name::text AS name, slug FROM categories WHERE name = ANY($1::citext[]) OR slug = ANY($2::text[])',
      [display, display.map(slugify)],
    );
    const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row.id]));
    const bySlug = new Map(rows.map((row) => [row.slug, row.id]));
    const result = new Map<string, string>();
    for (const [key, name] of unique) {
      const id = byName.get(key) ?? bySlug.get(slugify(name));
      if (id) result.set(key, id);
    }
    return result;
  }

  async insert(tx: Queryable, id: string, sku: string, write: ProductWrite): Promise<void> {
    await tx.query(
      `INSERT INTO products (id, sku, name, description, category_id, price_cents, currency, stock, weight_grams)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, sku, write.name, write.description, write.categoryId, write.priceCents, DEFAULT_CURRENCY, write.stock, write.weightGrams],
    );
  }

  async findById(id: string, db: Queryable = this.db): Promise<Product | null> {
    const { rows } = await db.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? toProduct(rows[0]) : null;
  }

  async findState(
    tx: Queryable,
    id: string,
  ): Promise<{ version: number; reserved: number; deleted: boolean } | null> {
    const { rows } = await tx.query<{ version: number; reserved: number; deleted: boolean }>(
      'SELECT version, reserved, deleted_at IS NOT NULL AS deleted FROM products WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async updateIfVersion(tx: Queryable, id: string, expectedVersion: number, write: ProductWrite): Promise<boolean> {
    const result = await tx.query(
      `UPDATE products SET name = $3, description = $4, category_id = $5, price_cents = $6, stock = $7,
         weight_grams = $8, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 AND deleted_at IS NULL AND $7 >= reserved`,
      [id, expectedVersion, write.name, write.description, write.categoryId, write.priceCents, write.stock, write.weightGrams],
    );
    return result.rowCount === 1;
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE products SET deleted_at = now(), version = version + 1, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL AND reserved = 0`,
      [id],
    );
    return result.rowCount === 1;
  }

  async search(query: ProductListQuery): Promise<{ items: Product[]; total: number; match: SearchMatch | null }> {
    const tokens = searchTokens(query.q);
    const strict = await this.runSearch(query, tokens, 'all');
    if (!query.q) return { ...strict, match: null };
    if (strict.total > 0 || tokens.length < 2) return { ...strict, match: 'all' };
    const partial = await this.runSearch(query, tokens, 'any');
    return { ...partial, match: partial.total > 0 ? 'partial' : 'all' };
  }

  private async runSearch(
    query: ProductListQuery,
    tokens: string[],
    mode: 'all' | 'any',
  ): Promise<{ items: Product[]; total: number }> {
    const values: unknown[] = [];
    const param = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);
    const conditions = ['p.deleted_at IS NULL'];
    let score = '0';
    if (query.q) {
      const raw = param(query.q);
      const upper = param(query.q.toUpperCase());
      const like = param(escapeLike(query.q));
      const tsq = `(websearch_to_tsquery('simple', ${raw}) || websearch_to_tsquery('english', ${raw}))`;
      const phraseFuzzy = tokens.length < 2 ? ` OR ${raw} <% p.name` : '';
      const phrase = `(p.search_vector @@ ${tsq}${phraseFuzzy} OR p.sku ILIKE ${like} || '%' OR p.name ILIKE '%' || ${like} || '%')`;
      const tokenConditions = tokens.map((token) => {
        const value = param(token);
        const tokenLike = param(escapeLike(token));
        return {
          condition: `(p.search_vector @@ (websearch_to_tsquery('simple', ${value}) || websearch_to_tsquery('english', ${value}))
            OR ${value} <% p.name OR p.name ILIKE '%' || ${tokenLike} || '%' OR p.sku ILIKE ${tokenLike} || '%')`,
          similarity: `word_similarity(${value}, p.name)`,
        };
      });
      const combined =
        tokenConditions.length > 1
          ? ` OR (${tokenConditions.map((token) => token.condition).join(mode === 'all' ? ' AND ' : ' OR ')})`
          : '';
      conditions.push(`(${phrase}${combined})`);
      const tokenScore = tokenConditions
        .map((token) => ` + ${token.similarity} + CASE WHEN ${token.condition} THEN 1 ELSE 0 END`)
        .join('');
      score = `(ts_rank_cd(p.search_vector, ${tsq}) * 2 + word_similarity(${raw}, p.name)
        + CASE WHEN p.sku = ${upper} THEN 10 ELSE 0 END
        + CASE WHEN p.name ILIKE '%' || ${like} || '%' THEN 0.5 ELSE 0 END${tokenScore})`;
    }
    if (query.category.length > 0) conditions.push(`c.slug = ANY(${param(query.category)}::text[])`);
    if (query.minPriceCents !== undefined) conditions.push(`p.price_cents >= ${param(query.minPriceCents)}`);
    if (query.maxPriceCents !== undefined) conditions.push(`p.price_cents <= ${param(query.maxPriceCents)}`);
    if (query.inStock) conditions.push('p.stock - p.reserved > 0');
    const sort = query.sort ?? (query.q ? 'relevance' : 'newest');
    const orderBy = sort === 'relevance' && !query.q ? SORT_SQL.newest : SORT_SQL[sort];
    const limit = param(query.pageSize);
    const offset = param((query.page - 1) * query.pageSize);
    const { rows } = await this.db.query<ProductRow & { total_items: number }>(
      `SELECT ${PRODUCT_COLUMNS}, ${score} AS score, count(*) OVER () AS total_items
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}, p.id
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    let total = rows[0]?.total_items ?? 0;
    if (rows.length === 0 && query.page > 1) {
      const countValues = values.slice(0, values.length - 2);
      const { rows: countRows } = await this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM products p JOIN categories c ON c.id = p.category_id
         WHERE ${conditions.join(' AND ')}`,
        countValues,
      );
      total = countRows[0]?.total ?? 0;
    }
    return { items: rows.map(toProduct), total };
  }

  async listCategories(): Promise<Category[]> {
    const { rows } = await this.db.query<{ id: string; name: string; slug: string; product_count: number }>(
      `SELECT c.id, c.name::text AS name, c.slug, count(p.id) FILTER (WHERE p.deleted_at IS NULL)::int AS product_count
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.name`,
    );
    return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, productCount: row.product_count }));
  }

  async snapshot(ids: string[]): Promise<ProductSnapshot[]> {
    const { rows } = await this.db.query<{
      id: string;
      sku: string;
      name: string;
      price_cents: number;
      currency: string;
      available: number;
      active: boolean;
    }>(
      `SELECT id, sku, name, price_cents, currency, stock - reserved AS available, deleted_at IS NULL AS active
       FROM products WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      priceCents: row.price_cents,
      currency: row.currency,
      available: row.available,
      active: row.active,
    }));
  }
}
