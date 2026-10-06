import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src';

type Doc = { openapi: string; paths: Record<string, Record<string, { responses: Record<string, unknown>; requestBody?: unknown }>> };

describe('OpenAPI document', () => {
  const doc = buildOpenApiDocument() as unknown as Doc;

  it('is OpenAPI 3.1 and serializable', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(() => JSON.stringify(doc)).not.toThrow();
  });

  it('documents every public route', () => {
    expect(Object.keys(doc.paths).sort()).toEqual(
      ['/categories', '/imports', '/imports/{id}', '/imports/{id}/issues', '/orders', '/orders/{id}', '/payments/methods', '/products', '/products/{id}'].sort(),
    );
    expect(Object.keys(doc.paths['/products/{id}'] ?? {}).sort()).toEqual(['delete', 'get', 'put']);
  });

  it('describes request bodies from the shared zod schemas', () => {
    const body = JSON.stringify(doc.paths['/products']?.post?.requestBody);
    for (const field of ['sku', 'name', 'category', 'priceCents', 'stock']) expect(body).toContain(field);
    expect(JSON.stringify(doc.paths['/imports']?.post?.requestBody)).toContain('multipart/form-data');
  });

  it('documents problem responses for failures', () => {
    expect(JSON.stringify(doc.paths['/orders']?.post?.responses)).toContain('application/problem+json');
    expect(Object.keys(doc.paths['/orders']?.post?.responses ?? {})).toEqual(expect.arrayContaining(['202', '409', '422', '428']));
  });
});
