import { z } from 'zod';

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

export const paginated = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), page: pageMetaSchema });
export type Paginated<T> = { data: T[]; page: PageMeta };

export function pageMeta(page: number, pageSize: number, totalItems: number): PageMeta {
  return { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) };
}

export const moneySchema = z.object({ amountCents: z.number().int(), currency: z.string().length(3) });
export type Money = z.infer<typeof moneySchema>;

export const fieldErrorSchema = z.object({ path: z.string(), message: z.string() });
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const problemSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  correlationId: z.string().optional(),
  errors: z.array(fieldErrorSchema).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export function problemType(code: string): string {
  return `https://stockroom.local/problems/${code.toLowerCase().replace(/_/g, '-')}`;
}
