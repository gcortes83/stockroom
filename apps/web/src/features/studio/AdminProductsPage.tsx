import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileUp, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Product } from '@stockroom/contracts';
import { useCategories } from '@/features/catalog/use-categories';
import { StockBadge } from '@/features/catalog/StockBadge';
import { api } from '@/shared/api/endpoints';
import { describeError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { cn } from '@/shared/lib/cn';
import { money, relative } from '@/shared/lib/format';
import { useDebounced } from '@/shared/lib/use-debounced';
import { buttonStyles } from '@/shared/ui/button';
import { Button } from '@/shared/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui/feedback';
import { Input } from '@/shared/ui/field';
import { Pagination } from '@/shared/ui/pagination';
import { ProductArt } from '@/shared/ui/product-art';
import { PageHeader } from '@/shared/ui/surface';
import { DeleteProductDialog } from './DeleteProductDialog';

export function AdminProductsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [deleting, setDeleting] = useState<Product | null>(null);
  const q = useDebounced(search.trim(), 300);
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? 1) || 1;
  const categories = useCategories();
  const listParams = { q, category: category ? [category] : [], page, pageSize: 20, sort: q ? undefined : ('newest' as const) };
  const products = useQuery({
    queryKey: keys.productList(listParams),
    queryFn: ({ signal }) => api.products(listParams, signal),
    placeholderData: keepPreviousData,
  });

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Products"
        description="Create, edit and retire products. Changes are visible in Discover immediately."
        actions={
          <>
            <Link to="/admin/imports" className={buttonStyles('secondary')}>
              <FileUp className="h-4 w-4" /> Import CSV
            </Link>
            <Link to="/admin/products/new" className={buttonStyles('primary')}>
              <Plus className="h-4 w-4" /> New product
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setParam('page', '');
            }}
            placeholder="Search by name, SKU or description"
            className="pl-9"
            aria-label="Search products"
          />
        </div>
        <select
          value={category}
          onChange={(event) => setParam('category', event.target.value)}
          className="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-fg"
          aria-label="Filter by category"
        >
          <option value="" className="bg-bg">
            All categories
          </option>
          {(categories.data ?? []).map((item) => (
            <option key={item.slug} value={item.slug} className="bg-bg">
              {item.name} ({item.productCount})
            </option>
          ))}
        </select>
      </div>
      {products.isError ? (
        <ErrorState message={describeError(products.error)} onRetry={() => void products.refetch()} />
      ) : products.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : products.data?.data.length === 0 ? (
        <EmptyState
          title={q || category ? 'No products match' : 'No products yet'}
          description={q || category ? 'Try a different search.' : 'Create one or import the example CSV.'}
          action={
            <Link to="/admin/products/new" className={buttonStyles('primary', 'sm')}>
              <Plus className="h-4 w-4" /> New product
            </Link>
          }
        />
      ) : (
        <div className={cn('glass overflow-hidden rounded-3xl transition-opacity', products.isPlaceholderData && 'opacity-60')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] tracking-wide text-subtle uppercase">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Stock</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.data?.data.map((product) => (
                  <tr key={product.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ProductArt seed={product.sku} categorySlug={product.category.slug} className="h-10 w-10 shrink-0 rounded-xl" />
                        <div className="min-w-0">
                          <Link to={`/admin/products/${product.id}/edit`} className="line-clamp-1 max-w-xs font-medium hover:text-accent">
                            {product.name}
                          </Link>
                          <div className="font-mono text-[11px] text-subtle">{product.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{product.category.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(product.price.amountCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {product.stock}
                      {product.reserved > 0 && <div className="text-[11px] text-warning">{product.reserved} reserved</div>}
                    </td>
                    <td className="px-4 py-3">
                      <StockBadge available={product.available} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{relative(product.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link to={`/admin/products/${product.id}/edit`} className={buttonStyles('ghost', 'icon')} aria-label={`Edit ${product.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(product)} aria-label={`Delete ${product.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {products.data && <Pagination page={products.data.page} onChange={(next) => setParam('page', String(next))} />}
      <DeleteProductDialog product={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
