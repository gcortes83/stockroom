import { z } from 'zod';
import { MAX_PRICE_CENTS, MAX_WEIGHT_GRAMS } from './money';
import { collapseWhitespace, normalizeSku, SKU_PATTERN } from './text';
import { moneySchema, pageQuerySchema, paginated, type Paginated } from './common';

export const MAX_STOCK = 1_000_000;

export const skuSchema = z
  .string()
  .transform(normalizeSku)
  .pipe(z.string().min(1, 'SKU is required').regex(SKU_PATTERN, 'SKU must be 2-64 letters, digits, "-" or "_"'));

export const productNameSchema = z
  .string()
  .transform(collapseWhitespace)
  .pipe(z.string().min(1, 'Name is required').max(200, 'Name must be at most 200 characters'));

export const categoryNameSchema = z
  .string()
  .transform(collapseWhitespace)
  .pipe(z.string().min(1, 'Category is required').max(60, 'Category must be at most 60 characters'));

const productFields = {
  name: productNameSchema,
  description: z
    .string()
    .max(5000, 'Description must be at most 5000 characters')
    .default('')
    .transform((value) => value.trim()),
  category: categoryNameSchema,
  priceCents: z.number().int().min(0, 'Price cannot be negative').max(MAX_PRICE_CENTS),
  stock: z.number().int('Stock must be a whole number').min(0, 'Stock cannot be negative').max(MAX_STOCK),
  weightGrams: z.number().int().min(0).max(MAX_WEIGHT_GRAMS).nullable().default(null),
};

export const createProductSchema = z.strictObject({ sku: skuSchema, ...productFields });
export type CreateProductInput = z.input<typeof createProductSchema>;
export type CreateProduct = z.output<typeof createProductSchema>;

export const updateProductSchema = z.strictObject(productFields);
export type UpdateProductInput = z.input<typeof updateProductSchema>;
export type UpdateProduct = z.output<typeof updateProductSchema>;

export const categoryRefSchema = z.object({ id: z.string(), name: z.string(), slug: z.string() });

export const productSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  category: categoryRefSchema,
  price: moneySchema,
  stock: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  weightGrams: z.number().int().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const SEARCH_MATCHES = ['all', 'partial'] as const;
export type SearchMatch = (typeof SEARCH_MATCHES)[number];

export const productListResponseSchema = paginated(productSchema).extend({ match: z.enum(SEARCH_MATCHES).nullable() });
export type ProductListResponse = Paginated<Product> & { match: SearchMatch | null };

export const categorySchema = categoryRefSchema.extend({ productCount: z.number().int() });
export type Category = z.infer<typeof categorySchema>;

export const PRODUCT_SORTS = ['relevance', 'price_asc', 'price_desc', 'name_asc', 'newest'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

const optionalCents = z.coerce.number().int().min(0).max(MAX_PRICE_CENTS).optional();

export const productListQuerySchema = pageQuerySchema
  .extend({
    q: z.string().trim().max(100).default(''),
    category: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]).filter(Boolean)),
    minPriceCents: optionalCents,
    maxPriceCents: optionalCents,
    inStock: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    sort: z.enum(PRODUCT_SORTS).optional(),
  })
  .refine(
    (value) =>
      value.minPriceCents === undefined ||
      value.maxPriceCents === undefined ||
      value.minPriceCents <= value.maxPriceCents,
    { message: 'minPriceCents must be less than or equal to maxPriceCents', path: ['minPriceCents'] },
  );
export type ProductListQuery = z.output<typeof productListQuerySchema>;

export const productSnapshotSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  priceCents: z.number().int(),
  currency: z.string(),
  available: z.number().int(),
  active: z.boolean(),
});
export type ProductSnapshot = z.infer<typeof productSnapshotSchema>;
