import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigurationError, loadConfig, resolveRequestId, titleFromCode, ValidationError, ZodPipe } from '../src';

describe('loadConfig', () => {
  it('fails fast with a readable message', () => {
    const schema = z.object({ PORT: z.coerce.number().int() });
    expect(() => loadConfig(schema, { PORT: 'abc' })).toThrow(ConfigurationError);
    expect(() => loadConfig(schema, { PORT: 'abc' })).toThrow(/PORT/);
  });

  it('applies defaults and coercion', () => {
    expect(loadConfig(z.object({ PORT: z.coerce.number().default(3000) }), {})).toEqual({ PORT: 3000 });
  });
});

describe('ZodPipe', () => {
  it('maps zod issues to field errors', () => {
    const pipe = new ZodPipe(z.object({ name: z.string().min(1, 'Name is required') }));
    try {
      pipe.transform({ name: '' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).errors).toEqual([{ path: 'name', message: 'Name is required' }]);
    }
  });
});

describe('request ids', () => {
  it('keeps safe incoming ids and replaces unsafe ones', () => {
    expect(resolveRequestId('abc-123')).toBe('abc-123');
    expect(resolveRequestId('bad id with spaces')).not.toBe('bad id with spaces');
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('titleFromCode', () => {
  it('humanizes codes', () => {
    expect(titleFromCode('PRODUCT_NOT_FOUND')).toBe('Product not found');
  });
});
