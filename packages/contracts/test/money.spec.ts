import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { centsToDecimalString, gramsToKgString, parseMoney, parseWeightKg } from '../src';

describe('parseMoney', () => {
  it.each([
    ['19.99', 1999],
    ['$29.99', 2999],
    ['0.00', 0],
    ['1,299.00', 129900],
    ['89.9', 8990],
    ['449', 44900],
    [' 45.50 ', 4550],
    ['USD 10', 1000],
  ])('parses %s as %i cents', (input, cents) => {
    expect(parseMoney(input)).toEqual({ ok: true, value: cents });
  });

  it.each([
    ['free', 'INVALID_FORMAT'],
    ['1.999', 'INVALID_FORMAT'],
    ['-1', 'INVALID_FORMAT'],
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['1e3', 'INVALID_FORMAT'],
    ['1000000.00', 'TOO_LARGE'],
  ])('rejects %s with %s', (input, error) => {
    expect(parseMoney(input)).toEqual({ ok: false, error });
  });

  it('round-trips any valid amount without float drift', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), (cents) => {
        expect(parseMoney(centsToDecimalString(cents))).toEqual({ ok: true, value: cents });
      }),
    );
  });

  it('keeps sums exact where floats drift', () => {
    const a = parseMoney('0.1');
    const b = parseMoney('0.2');
    expect(a.ok && b.ok && a.value + b.value).toBe(30);
  });
});

describe('parseWeightKg', () => {
  it.each([
    ['0.35', 350],
    ['35.0', 35000],
    ['0', 0],
    ['1.2', 1200],
  ])('parses %s kg as %i g', (input, grams) => {
    expect(parseWeightKg(input)).toEqual({ ok: true, value: grams });
  });

  it('treats empty weight as null', () => {
    expect(parseWeightKg('')).toEqual({ ok: true, value: null });
  });

  it('rejects malformed weight', () => {
    expect(parseWeightKg('heavy')).toEqual({ ok: false, error: 'INVALID_FORMAT' });
    expect(parseWeightKg('0.1234')).toEqual({ ok: false, error: 'INVALID_FORMAT' });
  });

  it('formats grams back to kg', () => {
    expect(gramsToKgString(350)).toBe('0.35');
    expect(gramsToKgString(35000)).toBe('35');
    expect(gramsToKgString(1250)).toBe('1.25');
  });
});
