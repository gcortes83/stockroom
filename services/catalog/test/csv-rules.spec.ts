import { describe, expect, it } from 'vitest';
import {
  dedupeBySku,
  escapeCsvCell,
  isBlankRow,
  issuesToCsv,
  missingColumns,
  normalizeHeader,
  validateRow,
  type ValidRow,
} from '../src/modules/imports/domain/csv-rules';

const row = (overrides: Record<string, string> = {}) => ({
  name: 'Running Shoes',
  sku: 'RS-001',
  description: 'Lightweight running shoes',
  category: 'Footwear',
  price: '89.99',
  stock: '150',
  weight_kg: '0.35',
  ...overrides,
});

const codesOf = (raw: Record<string, string>) => {
  const result = validateRow(raw, 7);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
};

describe('validateRow', () => {
  it('accepts a clean row', () => {
    expect(validateRow(row(), 2)).toEqual({
      ok: true,
      row: {
        line: 2,
        sku: 'RS-001',
        name: 'Running Shoes',
        description: 'Lightweight running shoes',
        category: 'Footwear',
        priceCents: 8999,
        stock: 150,
        weightGrams: 350,
      },
    });
  });

  it('normalizes a price with a currency symbol ($29.99)', () => {
    const result = validateRow(row({ price: '$29.99' }), 4);
    expect(result.ok && result.row.priceCents).toBe(2999);
  });

  it('rejects a non-numeric price (free)', () => {
    expect(codesOf(row({ price: 'free' }))).toEqual(['INVALID_PRICE']);
  });

  it('rejects negative stock (-5)', () => {
    expect(codesOf(row({ stock: '-5' }))).toEqual(['NEGATIVE_STOCK']);
  });

  it('rejects non-integer stock', () => {
    expect(codesOf(row({ stock: '10 units' }))).toEqual(['INVALID_STOCK']);
    expect(codesOf(row({ stock: '1.5' }))).toEqual(['INVALID_STOCK']);
  });

  it('rejects empty and whitespace-only names', () => {
    expect(codesOf(row({ name: '' }))).toEqual(['NAME_REQUIRED']);
    expect(codesOf(row({ name: '     ' }))).toEqual(['NAME_REQUIRED']);
  });

  it('rejects an empty category', () => {
    expect(codesOf(row({ category: '' }))).toEqual(['CATEGORY_REQUIRED']);
  });

  it('accepts an empty weight as null', () => {
    const result = validateRow(row({ weight_kg: '' }), 50);
    expect(result.ok && result.row.weightGrams).toBeNull();
  });

  it('accepts zero price and zero stock', () => {
    const result = validateRow(row({ price: '0.00', stock: '0' }), 47);
    expect(result.ok && [result.row.priceCents, result.row.stock]).toEqual([0, 0]);
  });

  it('keeps markup and SQL-looking names as literal text', () => {
    const script = validateRow(row({ name: "<script>alert('xss')</script>" }), 20);
    const sql = validateRow(row({ name: "Robert'); DROP TABLE products;--" }), 29);
    expect(script.ok && script.row.name).toBe("<script>alert('xss')</script>");
    expect(sql.ok && sql.row.name).toBe("Robert'); DROP TABLE products;--");
  });

  it('reports every failing field of a row', () => {
    expect(codesOf({ name: '', sku: '', description: '', category: '', price: '', stock: '', weight_kg: 'x' })).toEqual([
      'SKU_REQUIRED',
      'NAME_REQUIRED',
      'CATEGORY_REQUIRED',
      'PRICE_REQUIRED',
      'STOCK_REQUIRED',
      'INVALID_WEIGHT',
    ]);
  });
});

describe('headers and blank rows', () => {
  it('normalizes headers', () => {
    expect(normalizeHeader(' Weight KG ')).toBe('weight_kg');
  });

  it('reports missing columns', () => {
    expect(missingColumns(['name', 'sku', 'price'])).toEqual(['description', 'category', 'stock', 'weight_kg']);
    expect(missingColumns(null)).toHaveLength(7);
  });

  it('detects fully blank rows', () => {
    expect(isBlankRow({ name: '', sku: ' ', price: '' })).toBe(true);
    expect(isBlankRow(row())).toBe(false);
  });
});

describe('dedupeBySku', () => {
  const valid = (line: number, sku: string, priceCents: number): ValidRow => ({
    line,
    sku,
    name: 'n',
    description: '',
    category: 'c',
    priceCents,
    stock: 1,
    weightGrams: null,
  });

  it('keeps the last occurrence and warns on each replacement', () => {
    const { rows, warnings } = dedupeBySku([valid(11, 'BS-021', 5999), valid(56, 'BS-021', 4999), valid(89, 'BS-021', 5999)]);
    expect(rows).toEqual([valid(89, 'BS-021', 5999)]);
    expect(warnings.map((warning) => warning.line)).toEqual([56, 89]);
    expect(warnings.every((warning) => warning.severity === 'WARNING')).toBe(true);
  });
});

describe('error report export', () => {
  it('neutralizes spreadsheet formulas and quotes cells', () => {
    expect(escapeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvCell('-5')).toBe("'-5");
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  it('renders a CSV with a header', () => {
    const csv = issuesToCsv([
      { line: 16, sku: 'DL-007', field: 'stock', value: '-5', code: 'NEGATIVE_STOCK', message: 'Stock cannot be negative', severity: 'ERROR' },
    ]);
    expect(csv).toBe("line,sku,field,value,code,message,severity\r\n16,DL-007,stock,'-5,NEGATIVE_STOCK,Stock cannot be negative,ERROR\r\n");
  });
});
