import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '@stockroom/contracts';
import { cart } from '@/features/cart/cart-store';
import { money } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { ProductArt } from '@/shared/ui/product-art';
import { StockBadge } from './StockBadge';

export function addToCart(product: Product, quantity = 1) {
  const outcome = cart.add(product, quantity);
  if (outcome === 'full') toast.error('Your cart is full (50 different products max).');
  else if (outcome === 'capped') toast.warning(`Only ${product.available} of ${product.name} available — quantity adjusted.`);
  else toast.success(`${product.name} added to cart`);
}

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const soldOut = product.available <= 0;
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.03 }}
      className="group glass relative flex flex-col overflow-hidden rounded-3xl transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-[0_24px_60px_-30px_rgb(167_139_250/0.55)]"
    >
      <Link to={`/shop/products/${product.id}`} className="block focus:outline-none" aria-label={product.name}>
        <ProductArt
          seed={product.sku}
          categorySlug={product.category.slug}
          muted={soldOut}
          className="aspect-[4/3] transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium tracking-wide text-subtle uppercase">{product.category.name}</span>
          <StockBadge available={product.available} />
        </div>
        <Link to={`/shop/products/${product.id}`} className="line-clamp-2 min-h-10 text-sm leading-5 font-medium hover:text-accent">
          {product.name}
        </Link>
        <div className="mt-auto flex items-end justify-between gap-2">
          <div>
            <div className="text-lg font-semibold tabular-nums">{money(product.price.amountCents, product.price.currency)}</div>
            <div className="font-mono text-[10px] text-subtle">{product.sku}</div>
          </div>
          <Button size="icon" variant={soldOut ? 'secondary' : 'primary'} disabled={soldOut} onClick={() => addToCart(product)} aria-label={`Add ${product.name} to cart`}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="shimmer aspect-[4/3]" />
      <div className="space-y-3 p-4">
        <div className="shimmer h-3 w-1/3 rounded" />
        <div className="shimmer h-4 w-4/5 rounded" />
        <div className="shimmer h-6 w-1/4 rounded" />
      </div>
    </div>
  );
}
