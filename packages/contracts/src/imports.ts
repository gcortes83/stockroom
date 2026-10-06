import { z } from 'zod';

export const IMPORT_STATUSES = ['PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const ISSUE_SEVERITIES = ['ERROR', 'WARNING'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const importTotalsSchema = z.object({
  totalLines: z.number().int(),
  blankLines: z.number().int(),
  processedRows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  rejected: z.number().int(),
  warnings: z.number().int(),
});
export type ImportTotals = z.infer<typeof importTotalsSchema>;

export const importJobSchema = z.object({
  id: z.string(),
  filename: z.string(),
  source: z.enum(['UPLOAD', 'SEED']),
  status: z.enum(IMPORT_STATUSES),
  totals: importTotalsSchema,
  failureMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ImportJob = z.infer<typeof importJobSchema>;

export const importIssueSchema = z.object({
  line: z.number().int(),
  sku: z.string().nullable(),
  field: z.string().nullable(),
  value: z.string().nullable(),
  code: z.string(),
  message: z.string(),
  severity: z.enum(ISSUE_SEVERITIES),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const REQUIRED_CSV_COLUMNS = ['name', 'sku', 'description', 'category', 'price', 'stock', 'weight_kg'] as const;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
