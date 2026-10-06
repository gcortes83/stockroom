import { parseMoney, type ProductSort } from '@stockroom/contracts';

export type CategoryRef = { name: string; slug: string };

export type SmartFilter =
  | { kind: 'maxPrice'; label: string; fragment: string; cents: number }
  | { kind: 'minPrice'; label: string; fragment: string; cents: number }
  | { kind: 'category'; label: string; fragment: string; slug: string }
  | { kind: 'inStock'; label: string; fragment: string }
  | { kind: 'sort'; label: string; fragment: string; sort: ProductSort };

export type SmartQuery = {
  text: string;
  categories: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  inStock: boolean;
  sort?: ProductSort;
  filters: SmartFilter[];
};

const AMOUNT = String.raw`\$?\s*(\d{1,7}(?:\.\d{1,2})?)`;
const BETWEEN = new RegExp(String.raw`\bbetween\s+${AMOUNT}\s+(?:and|to|-)\s+${AMOUNT}`, 'i');
const MAX = new RegExp(String.raw`(?:\bunder|\bbelow|\bless than|\bcheaper than|\bup to|\bmax(?:imum)?|<=?)\s*${AMOUNT}`, 'i');
const MIN = new RegExp(String.raw`(?:\bover|\babove|\bmore than|\bat least|\bmin(?:imum)?|>=?)\s*${AMOUNT}`, 'i');
const IN_STOCK = /\b(?:in[\s-]stock|available(?:\s+now)?)\b/i;
const CHEAP = /\bcheap(?:est)?\b/i;
const PRICEY = /\b(?:premium|most expensive|priciest)\b/i;
const NEWEST = /\b(?:newest|latest|new arrivals?)\b/i;
const LEADING_FILLER = /^(?:show me|find me|find|search for|looking for|look for|i need|i want|get me|give me)(?:\s+|$)/i;
const EDGE_WORDS = /^(?:and|with|in|for|of|the|some|any|that|is|are)\s+|\s+(?:and|with|in|for|of|the|that|is|are)$/i;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function categoryPattern(name: string): RegExp {
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word === '&' ? '(?:&|and)' : escapeRegExp(word.replace(/s$/, '')) + 's?'));
  return new RegExp(String.raw`\b${words.join(String.raw`\s+`)}\b`, 'i');
}

const cents = (amount: string) => {
  const parsed = parseMoney(amount);
  return parsed.ok ? parsed.value : null;
};

const dollars = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value % 100 === 0 ? 0 : 2 }).format(
    value / 100,
  );

export function interpretQuery(input: string, categories: readonly CategoryRef[]): SmartQuery {
  let rest = ` ${input} `;
  const filters: SmartFilter[] = [];
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (match) rest = rest.replace(match[0], ' ');
    return match;
  };

  const between = take(BETWEEN);
  if (between) {
    const low = cents(between[1] ?? '');
    const high = cents(between[2] ?? '');
    if (low !== null && high !== null) {
      filters.push({ kind: 'minPrice', label: `From ${dollars(Math.min(low, high))}`, fragment: between[0], cents: Math.min(low, high) });
      filters.push({ kind: 'maxPrice', label: `Up to ${dollars(Math.max(low, high))}`, fragment: between[0], cents: Math.max(low, high) });
    }
  }
  const max = take(MAX);
  const maxCents = max ? cents(max[1] ?? '') : null;
  if (max && maxCents !== null) filters.push({ kind: 'maxPrice', label: `Up to ${dollars(maxCents)}`, fragment: max[0], cents: maxCents });
  const min = take(MIN);
  const minCents = min ? cents(min[1] ?? '') : null;
  if (min && minCents !== null) filters.push({ kind: 'minPrice', label: `From ${dollars(minCents)}`, fragment: min[0], cents: minCents });

  const stock = take(IN_STOCK);
  if (stock) filters.push({ kind: 'inStock', label: 'In stock', fragment: stock[0] });

  const cheap = take(CHEAP);
  if (cheap) filters.push({ kind: 'sort', label: 'Lowest price first', fragment: cheap[0], sort: 'price_asc' });
  const pricey = cheap ? null : take(PRICEY);
  if (pricey) filters.push({ kind: 'sort', label: 'Highest price first', fragment: pricey[0], sort: 'price_desc' });
  const newest = cheap || pricey ? null : take(NEWEST);
  if (newest) filters.push({ kind: 'sort', label: 'Newest first', fragment: newest[0], sort: 'newest' });

  const byLength = [...categories].sort((a, b) => b.name.length - a.name.length);
  for (const category of byLength) {
    const match = take(categoryPattern(category.name));
    if (match) filters.push({ kind: 'category', label: category.name, fragment: match[0], slug: category.slug });
  }

  let text = rest.replace(/\s+/g, ' ').trim().replace(LEADING_FILLER, '');
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(EDGE_WORDS, '').trim();
  }
  if (/^(?:products?|items?|things?|stuff)$/i.test(text)) text = '';

  const minFilter = filters.find((filter) => filter.kind === 'minPrice');
  const maxFilter = filters.find((filter) => filter.kind === 'maxPrice');
  const sortFilter = filters.find((filter) => filter.kind === 'sort');
  return {
    text,
    categories: filters.flatMap((filter) => (filter.kind === 'category' ? [filter.slug] : [])),
    minPriceCents: minFilter?.kind === 'minPrice' ? minFilter.cents : undefined,
    maxPriceCents: maxFilter?.kind === 'maxPrice' ? maxFilter.cents : undefined,
    inStock: filters.some((filter) => filter.kind === 'inStock'),
    sort: sortFilter?.kind === 'sort' ? sortFilter.sort : undefined,
    filters,
  };
}

export function removeFragment(input: string, fragment: string): string {
  return input.replace(fragment, ' ').replace(/\s+/g, ' ').trim();
}

export const SEARCH_SUGGESTIONS = [
  'waterproof gear under $50',
  'electronics in stock',
  'cheap kitchen essentials',
  'sports between $10 and $40',
  'gifts below $30',
  'bluetooth speaker',
];
