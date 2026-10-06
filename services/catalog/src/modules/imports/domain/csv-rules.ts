import {
  collapseWhitespace,
  type ImportIssue,
  MAX_STOCK,
  normalizeSku,
  parseMoney,
  parseWeightKg,
  REQUIRED_CSV_COLUMNS,
  SKU_PATTERN,
} from '@stockroom/contracts';

export type RawRow = Record<string, string | undefined>;

export type ValidRow = {
  line: number;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
  weightGrams: number | null;
};

export type RowValidation = { ok: true; row: ValidRow } | { ok: false; issues: ImportIssue[] };

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

export function missingColumns(header: readonly string[] | null): string[] {
  const present = new Set(header ?? []);
  return REQUIRED_CSV_COLUMNS.filter((column) => !present.has(column));
}

export function isBlankRow(row: RawRow): boolean {
  return Object.values(row).every((value) => (value ?? '').trim() === '');
}

const error = (line: number, sku: string | null, field: string, value: string, code: string, message: string): ImportIssue => ({
  line,
  sku,
  field,
  value,
  code,
  message,
  severity: 'ERROR',
});

export function validateRow(raw: RawRow, line: number): RowValidation {
  const issues: ImportIssue[] = [];
  const rawSku = raw.sku ?? '';
  const sku = normalizeSku(rawSku);
  const skuForIssue = sku === '' ? null : sku;

  if (sku === '') issues.push(error(line, null, 'sku', rawSku, 'SKU_REQUIRED', 'SKU is required'));
  else if (!SKU_PATTERN.test(sku))
    issues.push(error(line, skuForIssue, 'sku', rawSku, 'SKU_INVALID', 'SKU must be 2-64 letters, digits, "-" or "_"'));

  const rawName = raw.name ?? '';
  const name = collapseWhitespace(rawName);
  if (name === '') issues.push(error(line, skuForIssue, 'name', rawName, 'NAME_REQUIRED', 'Name is required'));
  else if (name.length > 200)
    issues.push(error(line, skuForIssue, 'name', rawName, 'NAME_TOO_LONG', 'Name must be at most 200 characters'));

  const description = (raw.description ?? '').trim();
  if (description.length > 5000)
    issues.push(
      error(line, skuForIssue, 'description', description.slice(0, 100), 'DESCRIPTION_TOO_LONG', 'Description must be at most 5000 characters'),
    );

  const rawCategory = raw.category ?? '';
  const category = collapseWhitespace(rawCategory);
  if (category === '') issues.push(error(line, skuForIssue, 'category', rawCategory, 'CATEGORY_REQUIRED', 'Category is required'));
  else if (category.length > 60)
    issues.push(error(line, skuForIssue, 'category', rawCategory, 'CATEGORY_TOO_LONG', 'Category must be at most 60 characters'));

  const rawPrice = raw.price ?? '';
  const price = parseMoney(rawPrice);
  if (!price.ok) {
    if (price.error === 'EMPTY') issues.push(error(line, skuForIssue, 'price', rawPrice, 'PRICE_REQUIRED', 'Price is required'));
    else if (price.error === 'TOO_LARGE')
      issues.push(error(line, skuForIssue, 'price', rawPrice, 'INVALID_PRICE', 'Price must be at most 999,999.99'));
    else
      issues.push(
        error(line, skuForIssue, 'price', rawPrice, 'INVALID_PRICE', 'Price must be a non-negative decimal number with up to 2 decimals'),
      );
  }

  const rawStock = raw.stock ?? '';
  const stockText = rawStock.trim();
  let stock = 0;
  if (stockText === '') issues.push(error(line, skuForIssue, 'stock', rawStock, 'STOCK_REQUIRED', 'Stock is required'));
  else if (/^-\d+$/.test(stockText))
    issues.push(error(line, skuForIssue, 'stock', rawStock, 'NEGATIVE_STOCK', 'Stock cannot be negative'));
  else if (!/^\d+$/.test(stockText) || Number(stockText) > MAX_STOCK)
    issues.push(
      error(line, skuForIssue, 'stock', rawStock, 'INVALID_STOCK', `Stock must be a whole number between 0 and ${MAX_STOCK}`),
    );
  else stock = Number(stockText);

  const rawWeight = raw.weight_kg ?? '';
  const weight = parseWeightKg(rawWeight);
  if (!weight.ok)
    issues.push(
      error(line, skuForIssue, 'weight_kg', rawWeight, 'INVALID_WEIGHT', 'Weight must be a non-negative number of kg with up to 3 decimals'),
    );

  if (issues.length > 0 || !price.ok || !weight.ok) return { ok: false, issues };
  return {
    ok: true,
    row: { line, sku, name, description, category, priceCents: price.value, stock, weightGrams: weight.value },
  };
}

export type DedupeResult = { rows: ValidRow[]; warnings: ImportIssue[] };

export function dedupeBySku(rows: readonly ValidRow[]): DedupeResult {
  const bySku = new Map<string, ValidRow>();
  const warnings: ImportIssue[] = [];
  for (const row of rows) {
    const previous = bySku.get(row.sku);
    if (previous) {
      warnings.push({
        line: row.line,
        sku: row.sku,
        field: 'sku',
        value: row.sku,
        code: 'DUPLICATE_SKU_IN_FILE',
        message: `SKU appears earlier in the file (line ${previous.line}); this row replaces it`,
        severity: 'WARNING',
      });
    }
    bySku.set(row.sku, row);
  }
  return { rows: [...bySku.values()].sort((a, b) => a.line - b.line), warnings };
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function issuesToCsv(issues: readonly ImportIssue[]): string {
  const header = 'line,sku,field,value,code,message,severity';
  const lines = issues.map((issue) =>
    [issue.line, issue.sku, issue.field, issue.value, issue.code, issue.message, issue.severity].map(escapeCsvCell).join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}
