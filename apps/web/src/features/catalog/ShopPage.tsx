import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { PackageSearch, SlidersHorizontal, Wand2 } from 'lucide-react';
import { parseMoney, PRODUCT_SORTS, type ProductSort } from '@stockroom/contracts';
import { api, type ProductListParams } from '@/shared/api/endpoints';
import { describeError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { cn } from '@/shared/lib/cn';
import { interpretQuery, removeFragment, type SmartFilter } from '@/shared/lib/smart-query';
import { useDebounced } from '@/shared/lib/use-debounced';
import { Button } from '@/shared/ui/button';
import { EmptyState, ErrorState } from '@/shared/ui/feedback';
import { Input } from '@/shared/ui/field';
import { Pagination } from '@/shared/ui/pagination';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { SmartSearch } from './SmartSearch';
import { useCategories } from './use-categories';

const SORT_LABELS: Record<ProductSort, string> = {
  relevance: 'Best match',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  name_asc: 'Name A–Z',
  newest: 'Newest',
};

const toCents = (value: string | null) => {
  if (!value) return undefined;
  const parsed = parseMoney(value);
  return parsed.ok ? parsed.value : undefined;
};

export function ShopPage() {
  const [params, setParams] = useSearchParams();
  const prompt = params.get('q') ?? '';
  const [draft, setDraft] = useState(prompt);
  const debouncedDraft = useDebounced(draft, 400);
  const categories = useCategories();

  useEffect(() => setDraft(prompt), [prompt]);

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void, resetPage = true) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          mutate(next);
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (debouncedDraft !== draft || draft.trim() === prompt.trim()) return;
    update((next) => (draft.trim() ? next.set('q', draft.trim()) : next.delete('q')));
  }, [debouncedDraft, draft, prompt, update]);

  const smart = useMemo(() => interpretQuery(prompt, categories.data ?? []), [prompt, categories.data]);
  const explicitCategories = params.getAll('category');
  const explicitSort = params.get('sort') as ProductSort | null;
  const queryParams: ProductListParams = {
    q: smart.text,
    category: [...new Set([...explicitCategories, ...smart.categories])],
    minPriceCents: toCents(params.get('min')) ?? smart.minPriceCents,
    maxPriceCents: toCents(params.get('max')) ?? smart.maxPriceCents,
    inStock: params.get('stock') === '1' || smart.inStock,
    sort: explicitSort && PRODUCT_SORTS.includes(explicitSort) ? explicitSort : smart.sort,
    page: Number(params.get('page') ?? 1) || 1,
    pageSize: 24,
  };

  const products = useQuery({
    queryKey: keys.productList(queryParams),
    queryFn: ({ signal }) => api.products(queryParams, signal),
    placeholderData: keepPreviousData,
  });

  const removeSmartFilter = (filter: SmartFilter) => {
    const next = removeFragment(prompt, filter.fragment);
    setDraft(next);
    update((search) => (next ? search.set('q', next) : search.delete('q')));
  };

  const toggleCategory = (slug: string) =>
    update((next) => {
      const current = next.getAll('category');
      next.delete('category');
      (current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]).forEach((item) => next.append('category', item));
    });

  const hasFilters =
    prompt || explicitCategories.length > 0 || params.get('min') || params.get('max') || params.get('stock') || params.get('sort');
  const hero = !prompt && queryParams.page === 1;

  return (
    <div className="space-y-8">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn('mx-auto max-w-3xl text-center', hero ? 'pt-6 pb-2 sm:pt-10' : 'pt-0')}
      >
        {hero && (
          <>
            <div className="glass mx-auto mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-muted">
              <span className="bg-ai h-1.5 w-1.5 rounded-full" /> Smart search understands prices, categories and intent
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Find anything in the <span className="text-gradient">stockroom</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm text-muted sm:text-base">
              Describe what you need in your own words. Stockroom Assist turns it into filters you can see and tweak.
            </p>
          </>
        )}
        <div className={cn(hero ? 'mt-8' : 'mt-0', 'text-left')}>
          <SmartSearch
            value={draft}
            onChange={setDraft}
            onSubmit={() => update((next) => (draft.trim() ? next.set('q', draft.trim()) : next.delete('q')))}
            interpreted={smart.filters}
            remainingText={smart.filters.length > 0 ? smart.text : ''}
            onRemoveFilter={removeSmartFilter}
          />
        </div>
      </motion.section>

      <section aria-label="Filters" className="space-y-4">
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {(categories.data ?? [])
            .filter((category) => category.productCount > 0)
            .map((category) => {
              const active = explicitCategories.includes(category.slug) || smart.categories.includes(category.slug);
              return (
                <button
                  key={category.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleCategory(category.slug)}
                  className={cn(
                    'rounded-full border px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-all',
                    active ? 'border-transparent bg-ai text-white shadow-[0_6px_20px_-8px_rgb(244_114_182/0.8)]' : 'glass text-muted hover:text-fg',
                  )}
                >
                  {category.name} <span className={cn('ml-1 tabular-nums', active ? 'text-white/80' : 'text-subtle')}>{category.productCount}</span>
                </button>
              );
            })}
        </div>
        <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3">
          <SlidersHorizontal className="ml-1 h-4 w-4 text-subtle" aria-hidden />
          <label className="flex items-center gap-2 text-xs text-muted">
            Min $
            <Input
              defaultValue={params.get('min') ?? ''}
              key={`min-${params.get('min') ?? ''}`}
              inputMode="decimal"
              placeholder="0"
              className="h-8 w-20"
              onBlur={(event) => update((next) => (event.target.value ? next.set('min', event.target.value) : next.delete('min')))}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            Max $
            <Input
              defaultValue={params.get('max') ?? ''}
              key={`max-${params.get('max') ?? ''}`}
              inputMode="decimal"
              placeholder="∞"
              className="h-8 w-20"
              onBlur={(event) => update((next) => (event.target.value ? next.set('max', event.target.value) : next.delete('max')))}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted select-none">
            <input
              type="checkbox"
              checked={queryParams.inStock ?? false}
              onChange={(event) => update((next) => (event.target.checked ? next.set('stock', '1') : next.delete('stock')))}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            In stock only
          </label>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Sort
            <select
              value={queryParams.sort ?? (smart.text ? 'relevance' : 'newest')}
              onChange={(event) => update((next) => next.set('sort', event.target.value))}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-fg focus:outline-none"
            >
              {PRODUCT_SORTS.map((sort) => (
                <option key={sort} value={sort} className="bg-bg">
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </section>

      <section aria-label="Results" aria-busy={products.isFetching}>
        <div className="mb-4 flex items-center justify-between text-sm text-muted">
          <span>
            {products.data ? (
              <>
                <span className="font-semibold text-fg tabular-nums">{products.data.page.totalItems}</span> products
              </>
            ) : (
              'Loading products…'
            )}
          </span>
          {products.isFetching && !products.isLoading && <span className="shimmer-text text-xs">Updating results…</span>}
        </div>
        {products.data?.match === 'partial' && (
          <div role="status" className="glass mb-4 flex items-start gap-2 rounded-2xl border-accent/30 px-4 py-3 text-sm text-muted">
            <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>
              No product matches every word of <span className="font-medium text-fg">“{smart.text}”</span>. Showing the closest
              matches, best first.
            </span>
          </div>
        )}
        {products.isError ? (
          <ErrorState message={describeError(products.error)} onRetry={() => void products.refetch()} />
        ) : products.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
          </div>
        ) : products.data && products.data.data.length === 0 ? (
          <EmptyState
            icon={<PackageSearch className="h-6 w-6" />}
            title="Nothing matches yet"
            description="Try fewer words, a wider price range, or remove a filter."
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDraft('');
                    setParams(new URLSearchParams(), { replace: true });
                  }}
                >
                  Clear all filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={cn('grid grid-cols-2 gap-3 transition-opacity sm:gap-5 md:grid-cols-3 lg:grid-cols-4', products.isPlaceholderData && 'opacity-60')}>
            {products.data?.data.map((product, index) => (
              <ProductCard key={product.id} product={product} index={index} />
            ))}
          </div>
        )}
        {products.data && (
          <Pagination
            page={products.data.page}
            onChange={(page) => {
              update((next) => next.set('page', String(page)), false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </section>
    </div>
  );
}
