import { err, ok, type Result } from './result';

export const DEFAULT_CURRENCY = 'USD';
export const MAX_PRICE_CENTS = 99_999_999;
export const MAX_WEIGHT_GRAMS = 1_000_000;

export type MoneyParseError = 'EMPTY' | 'INVALID_FORMAT' | 'TOO_LARGE';
export type WeightParseError = 'INVALID_FORMAT' | 'TOO_LARGE';

const THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const DECIMAL_2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL_3 = /^\d+(\.\d{1,3})?$/;

function decimalToScaledInteger(value: string, scale: number): number {
  const [integerPart = '0', fractionPart = ''] = value.split('.');
  return Number(integerPart) * 10 ** scale + Number(fractionPart.padEnd(scale, '0') || '0');
}

export function parseMoney(input: string): Result<number, MoneyParseError> {
  let value = input.trim();
  if (value === '') return err('EMPTY');
  value = value.replace(/^(\$|USD)\s*/i, '');
  if (THOUSANDS.test(value)) value = value.replace(/,/g, '');
  if (!DECIMAL_2.test(value)) return err('INVALID_FORMAT');
  const cents = decimalToScaledInteger(value, 2);
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_CENTS) return err('TOO_LARGE');
  return ok(cents);
}

export function parseWeightKg(input: string): Result<number | null, WeightParseError> {
  const value = input.trim();
  if (value === '') return ok(null);
  if (!DECIMAL_3.test(value)) return err('INVALID_FORMAT');
  const grams = decimalToScaledInteger(value, 3);
  if (!Number.isSafeInteger(grams) || grams > MAX_WEIGHT_GRAMS) return err('TOO_LARGE');
  return ok(grams);
}

export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function gramsToKgString(grams: number): string {
  const integer = Math.trunc(grams / 1000);
  const fraction = String(grams % 1000).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : String(integer);
}

export function formatMoney(cents: number, currency: string = DEFAULT_CURRENCY, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
