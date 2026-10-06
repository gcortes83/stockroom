import { describe, expect, it } from 'vitest';
import { interpretQuery, removeFragment } from './smart-query';

const categories = [
  { name: 'Electronics', slug: 'electronics' },
  { name: 'Home & Office', slug: 'home-and-office' },
  { name: 'Sports', slug: 'sports' },
  { name: 'Gifts', slug: 'gifts' },
  { name: 'Kitchen', slug: 'kitchen' },
];

describe('interpretQuery', () => {
  it('keeps plain keywords as text', () => {
    expect(interpretQuery('bluetooth speaker', categories)).toMatchObject({ text: 'bluetooth speaker', filters: [] });
  });

  it('extracts a price ceiling and keeps the rest', () => {
    const result = interpretQuery('waterproof gear under $50', categories);
    expect(result).toMatchObject({ text: 'waterproof gear', maxPriceCents: 5000 });
  });

  it('extracts categories, stock and price ranges', () => {
    const result = interpretQuery('show me sports between 10 and $40 in stock', categories);
    expect(result).toMatchObject({ text: '', categories: ['sports'], minPriceCents: 1000, maxPriceCents: 4000, inStock: true });
  });

  it('matches multi-word categories with "and" and singular forms', () => {
    expect(interpretQuery('home and office lamp', categories)).toMatchObject({ text: 'lamp', categories: ['home-and-office'] });
    expect(interpretQuery('a gift below 30', categories)).toMatchObject({ categories: ['gifts'], maxPriceCents: 3000 });
  });

  it('turns intent words into sorting', () => {
    expect(interpretQuery('cheap kitchen essentials', categories)).toMatchObject({
      text: 'essentials',
      sort: 'price_asc',
      categories: ['kitchen'],
    });
  });

  it('treats hostile input as plain text', () => {
    expect(interpretQuery("<script>alert('x')</script>", categories).text).toBe("<script>alert('x')</script>");
  });

  it('removes an interpreted fragment from the prompt', () => {
    expect(removeFragment('waterproof gear under $50', 'under $50')).toBe('waterproof gear');
  });
});
