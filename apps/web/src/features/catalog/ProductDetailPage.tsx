import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowLeft, Minus, PackageCheck, Plus, Ruler, ShoppingBag, Tag, Zap } from 'lucide-react';
import { MAX_LINE_QUANTITY } from '@stockroom/contracts';
import { api } from '@/shared/api/endpoints';
import { describeError, ProblemError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { money, weight } from '@/shared/lib/format';
import { Button, buttonStyles } from '@/shared/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui/feedback';
import { ProductArt } from '@/shared/ui/product-art';
import { Glass } from '@/shared/ui/surface';
import { useNavigate } from 'react-router';
import { addToCart } from './ProductCard';
import { StockBadge } from './StockBadge';

export function highlights(description: string): string[] {
  return description
    .split(/[,;]|\s—\s|\.\s/)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter((part) => part.length > 2 && part.length < 60)
    .slice(0, 6);
}

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const product = useQuery({ queryKey: keys.product(id), queryFn: ({ signal }) => api.product(id, signal) });

  if (product.isLoading)
    return (
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="aspect-square rounded-3xl" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  if (product.error instanceof ProblemError && product.error.status === 404)
    return (
      <EmptyState
        title="Product not found"
        description="It may have been removed from the catalog."
        action={
          <Link to="/shop" className={buttonStyles('secondary', 'sm')}>
            Back to Discover
          </Link>
        }
      />
    );
  if (product.isError || !product.data) return <ErrorState message={describeError(product.error)} onRetry={() => void product.refetch()} />;

  const item = product.data;
  const soldOut = item.available <= 0;
  const maxQuantity = Math.min(item.available, MAX_LINE_QUANTITY);
  const points = highlights(item.description);

  return (
    <div className="space-y-6">
      <Link to="/shop" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back to Discover
      </Link>
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="glass overflow-hidden rounded-[2rem] p-2">
          <ProductArt seed={item.sku} categorySlug={item.category.slug} muted={soldOut} className="aspect-square rounded-[1.6rem]" iconClassName="h-1/4 w-1/4" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/shop?category=${item.category.slug}`} className="text-xs font-semibold tracking-[0.18em] text-accent uppercase hover:underline">
                {item.category.name}
              </Link>
              <StockBadge available={item.available} />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-balance break-words sm:text-4xl">{item.name}</h1>
            <p className="font-mono text-xs text-subtle">SKU {item.sku}</p>
          </div>
          <div className="text-4xl font-semibold tabular-nums">{money(item.price.amountCents, item.price.currency)}</div>
          {item.description && <p className="leading-relaxed break-words text-muted">{item.description}</p>}
          {points.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <Zap className="h-3.5 w-3.5 text-accent" /> Highlights
              </div>
              <div className="flex flex-wrap gap-2">
                {points.map((point) => (
                  <span key={point} className="glass rounded-full px-3 py-1 text-xs text-fg">
                    {point}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Glass className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <div className="glass flex items-center rounded-xl">
                <Button variant="ghost" size="icon" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1 || soldOut} aria-label="Decrease quantity">
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-10 text-center tabular-nums" aria-live="polite">
                  {soldOut ? 0 : quantity}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
                  disabled={quantity >= maxQuantity || soldOut}
                  aria-label="Increase quantity"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <Button className="flex-1" size="lg" disabled={soldOut} onClick={() => addToCart(item, quantity)}>
                <ShoppingBag className="h-4 w-4" /> {soldOut ? 'Out of stock' : 'Add to cart'}
              </Button>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              disabled={soldOut}
              onClick={() => {
                addToCart(item, quantity);
                void navigate('/shop/checkout');
              }}
            >
              Buy now
            </Button>
          </Glass>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[
              { icon: PackageCheck, label: 'Available', value: String(item.available) },
              { icon: Ruler, label: 'Weight', value: weight(item.weightGrams) },
              { icon: Tag, label: 'Category', value: item.category.name },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="glass rounded-2xl p-3">
                <dt className="flex items-center gap-1.5 text-[11px] text-subtle uppercase">
                  <Icon className="h-3.5 w-3.5" /> {label}
                </dt>
                <dd className="mt-1 truncate font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </div>
    </div>
  );
}
