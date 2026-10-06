import { z } from 'zod';
import { paginated, problemSchema } from './common';
import { importIssueSchema, importJobSchema } from './imports';
import { orderSchema, orderSummarySchema, placeOrderSchema } from './orders';
import { createPaymentMethodSchema, paymentMethodSchema } from './payments';
import { categorySchema, createProductSchema, PRODUCT_SORTS, productListResponseSchema, productSchema, updateProductSchema } from './products';

type JsonSchema = Record<string, unknown>;

type Parameter = {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema: JsonSchema;
};

type Response = { description: string; schema?: z.ZodType; contentType?: string; headers?: Record<string, string> };

type Operation = {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  tag: string;
  summary: string;
  parameters?: Parameter[];
  body?: z.ZodType;
  multipart?: boolean;
  responses: Record<string, Response>;
};

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema;
  return rest;
}

const uuidPath = (name: string, description: string): Parameter => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', format: 'uuid' },
});

const pageParams: Parameter[] = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];

const problem = (description: string): Response => ({ description, schema: problemSchema, contentType: 'application/problem+json' });

const PROBLEMS = {
  400: problem('Validation failed (problem+json with `errors[]`)'),
  404: problem('Resource not found'),
  409: problem('Conflict with the current state'),
};

export const PUBLIC_OPERATIONS: readonly Operation[] = [
  {
    method: 'get',
    path: '/products',
    tag: 'Products',
    summary: 'List and search products',
    parameters: [
      { name: 'q', in: 'query', description: 'Free-text query (name, SKU, description); typo tolerant', schema: { type: 'string', maxLength: 100 } },
      { name: 'category', in: 'query', description: 'Category slug; repeat for several', schema: { type: 'array', items: { type: 'string' } } },
      { name: 'minPriceCents', in: 'query', schema: { type: 'integer', minimum: 0 } },
      { name: 'maxPriceCents', in: 'query', schema: { type: 'integer', minimum: 0 } },
      { name: 'inStock', in: 'query', schema: { type: 'boolean' } },
      { name: 'sort', in: 'query', schema: { type: 'string', enum: [...PRODUCT_SORTS] } },
      ...pageParams,
    ],
    responses: {
      200: {
        description: 'A page of products. `match` is `partial` when no product matched every word and results match some of them; null without `q`.',
        schema: productListResponseSchema,
      },
      400: PROBLEMS[400],
    },
  },
  {
    method: 'post',
    path: '/products',
    tag: 'Products',
    summary: 'Create a product',
    body: createProductSchema,
    responses: {
      201: { description: 'Created', schema: productSchema, headers: { Location: 'URL of the product', ETag: 'Product version' } },
      400: PROBLEMS[400],
      409: problem('DUPLICATE_SKU'),
    },
  },
  {
    method: 'get',
    path: '/products/{id}',
    tag: 'Products',
    summary: 'Get a product',
    parameters: [uuidPath('id', 'Product id')],
    responses: { 200: { description: 'The product', schema: productSchema, headers: { ETag: 'Product version' } }, 404: PROBLEMS[404] },
  },
  {
    method: 'put',
    path: '/products/{id}',
    tag: 'Products',
    summary: 'Update a product (optimistic concurrency)',
    parameters: [
      uuidPath('id', 'Product id'),
      { name: 'If-Match', in: 'header', required: true, description: 'Current version, e.g. "3"', schema: { type: 'string' } },
    ],
    body: updateProductSchema,
    responses: {
      200: { description: 'Updated', schema: productSchema },
      400: PROBLEMS[400],
      404: PROBLEMS[404],
      409: problem('VERSION_CONFLICT or STOCK_BELOW_RESERVED'),
      428: problem('PRECONDITION_REQUIRED: If-Match missing'),
    },
  },
  {
    method: 'delete',
    path: '/products/{id}',
    tag: 'Products',
    summary: 'Soft-delete a product',
    parameters: [uuidPath('id', 'Product id')],
    responses: { 204: { description: 'Deleted' }, 404: PROBLEMS[404], 409: problem('PRODUCT_HAS_ACTIVE_RESERVATIONS') },
  },
  {
    method: 'get',
    path: '/categories',
    tag: 'Products',
    summary: 'List categories with product counts',
    responses: { 200: { description: 'Categories', schema: z.object({ data: z.array(categorySchema) }) } },
  },
  {
    method: 'post',
    path: '/imports',
    tag: 'Imports',
    summary: 'Import products from a CSV file',
    multipart: true,
    responses: {
      201: { description: 'Import finished; see totals', schema: importJobSchema },
      400: problem('UNSUPPORTED_FILE or missing file'),
      413: problem('FILE_TOO_LARGE or TOO_MANY_ROWS'),
      422: problem('CSV_INVALID_HEADER'),
    },
  },
  {
    method: 'get',
    path: '/imports',
    tag: 'Imports',
    summary: 'Import history',
    parameters: pageParams,
    responses: { 200: { description: 'A page of import jobs', schema: paginated(importJobSchema) } },
  },
  {
    method: 'get',
    path: '/imports/{id}',
    tag: 'Imports',
    summary: 'Import job report',
    parameters: [uuidPath('id', 'Import job id')],
    responses: { 200: { description: 'The import job', schema: importJobSchema }, 404: PROBLEMS[404] },
  },
  {
    method: 'get',
    path: '/imports/{id}/issues',
    tag: 'Imports',
    summary: 'Row issues of an import (JSON page or CSV export)',
    parameters: [
      uuidPath('id', 'Import job id'),
      { name: 'severity', in: 'query', schema: { type: 'string', enum: ['ERROR', 'WARNING'] } },
      { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } },
      ...pageParams,
    ],
    responses: { 200: { description: 'Issues (JSON) or a CSV attachment when format=csv', schema: paginated(importIssueSchema) }, 404: PROBLEMS[404] },
  },
  {
    method: 'post',
    path: '/payments/methods',
    tag: 'Payments',
    summary: 'Tokenize a (test) card',
    body: createPaymentMethodSchema,
    responses: { 201: { description: 'Payment method token', schema: paymentMethodSchema }, 400: PROBLEMS[400] },
  },
  {
    method: 'post',
    path: '/orders',
    tag: 'Orders',
    summary: 'Place an order (asynchronous checkout saga)',
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, description: 'UUID; retries with the same key replay the order', schema: { type: 'string', format: 'uuid' } }],
    body: placeOrderSchema,
    responses: {
      202: { description: 'Order accepted (PENDING)', schema: orderSchema, headers: { Location: 'URL of the order', 'Idempotent-Replayed': 'true on replays' } },
      400: PROBLEMS[400],
      409: problem('PRODUCT_UNAVAILABLE, INSUFFICIENT_STOCK or PRICE_CHANGED'),
      422: problem('IDEMPOTENCY_KEY_REUSED'),
      428: problem('IDEMPOTENCY_KEY_REQUIRED'),
      503: problem('CATALOG_UNAVAILABLE'),
    },
  },
  {
    method: 'get',
    path: '/orders',
    tag: 'Orders',
    summary: 'List orders',
    parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'AWAITING_PAYMENT', 'CONFIRMED', 'CANCELLED'] } }],
    responses: { 200: { description: 'A page of orders', schema: paginated(orderSummarySchema) } },
  },
  {
    method: 'get',
    path: '/orders/{id}',
    tag: 'Orders',
    summary: 'Get an order and its saga status',
    parameters: [uuidPath('id', 'Order id')],
    responses: { 200: { description: 'The order', schema: orderSchema }, 404: PROBLEMS[404] },
  },
];

export function buildOpenApiDocument(serverUrl = '/api/v1'): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of PUBLIC_OPERATIONS) {
    const responses: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(operation.responses)) {
      responses[status] = {
        description: response.description,
        ...(response.headers && {
          headers: Object.fromEntries(
            Object.entries(response.headers).map(([name, description]) => [name, { description, schema: { type: 'string' } }]),
          ),
        }),
        ...(response.schema && {
          content: { [response.contentType ?? 'application/json']: { schema: jsonSchema(response.schema, 'output') } },
        }),
      };
    }
    const requestBody = operation.multipart
      ? {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: 'CSV file, max 5 MB' } } },
            },
          },
        }
      : operation.body
        ? { required: true, content: { 'application/json': { schema: jsonSchema(operation.body, 'input') } } }
        : undefined;
    paths[operation.path] = {
      ...paths[operation.path],
      [operation.method]: {
        tags: [operation.tag],
        summary: operation.summary,
        operationId: `${operation.method}${operation.path.replace(/[{}]/g, '').replace(/\/(\w)/g, (_, char: string) => char.toUpperCase())}`,
        ...(operation.parameters && { parameters: operation.parameters }),
        ...(requestBody && { requestBody }),
        responses,
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Stockroom API',
      version: '1.0.0',
      description:
        'Public API of the Stockroom e-commerce challenge. Errors use application/problem+json (RFC 9457). Every response carries an x-request-id header.',
    },
    servers: [{ url: serverUrl }],
    tags: [{ name: 'Products' }, { name: 'Imports' }, { name: 'Payments' }, { name: 'Orders' }],
    paths,
  };
}
