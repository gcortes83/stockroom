import { Link } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { api } from '@/shared/api/endpoints';
import { keys } from '@/shared/api/keys';
import { money } from '@/shared/lib/format';
import { Button, buttonStyles } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/feedback';
import { ProductArt } from '@/shared/ui/product-art';
import { Glass, PageHeader } from '@/shared/ui/surface';
import { cart, cartTotals, useCart } from './cart-store';

export function CartPage() {
  const lines = useCart();
  const { subtotalCents, itemCount } = cartTotals(lines);
  const fresh = useQueries({
    queries: lines.map((line) => ({
      queryKey: keys.product(line.productId),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const product = await api.product(line.productId, signal);
        cart.refresh(product);
        return product;
      },
      staleTime: 10_000,
      retry: false,
    })),
  });

  if (lines.length === 0)
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Your cart is empty"
          description="Discover products and add them here. Your cart is saved on this device."
          action={
            <Link to="/shop" className={buttonStyles('primary', 'sm')}>
              Start discovering
            </Link>
          }
        />
      </div>
    );

  const unavailable = lines.filter((line, index) => fresh[index]?.isError || line.available < line.quantity);

  return (
    <div>
      <PageHeader eyebrow="Cart" title="Review your picks" description={`${itemCount} item${itemCount === 1 ? '' : 's'} ready for checkout.`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {lines.map((line, index) => {
              const missing = fresh[index]?.isError;
              const short = !missing && line.available < line.quantity;
              return (
                <motion.div
                  key={line.productId}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="glass flex items-center gap-4 rounded-3xl p-3 pr-4"
                >
                  <ProductArt seed={line.sku} categorySlug={line.categorySlug} className="h-20 w-20 shrink-0 rounded-2xl" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link to={`/shop/products/${line.productId}`} className="line-clamp-1 font-medium hover:text-accent">
                      {line.name}
                    </Link>
                    <div className="font-mono text-[11px] text-subtle">{line.sku}</div>
                    {(missing || short) && (
                      <div className="flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {missing ? 'No longer available' : `Only ${line.available} available`}
                      </div>
                    )}
                  </div>
                  <div className="glass flex items-center rounded-xl">
                    <Button variant="ghost" size="icon" aria-label="Decrease quantity" onClick={() => cart.setQuantity(line.productId, line.quantity - 1)} disabled={line.quantity <= 1}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-8 text-center text-sm tabular-nums">{line.quantity}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Increase quantity"
                      onClick={() => cart.setQuantity(line.productId, line.quantity + 1)}
                      disabled={line.quantity >= line.available}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="hidden w-24 text-right font-semibold tabular-nums sm:block">{money(line.unitPriceCents * line.quantity)}</div>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${line.name}`} onClick={() => cart.remove(line.productId)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        <Glass className="h-fit space-y-4 p-6 lg:sticky lg:top-24">
          <h2 className="font-semibold">Summary</h2>
          <div className="flex justify-between text-sm text-muted">
            <span>Subtotal</span>
            <span className="text-fg tabular-nums">{money(subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted">
            <span>Shipping</span>
            <span>Not applicable in this demo</span>
          </div>
          <div className="flex items-end justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">Total</span>
            <span className="text-2xl font-semibold tabular-nums">{money(subtotalCents)}</span>
          </div>
          {unavailable.length > 0 ? (
            <p className="rounded-xl bg-warning/10 p-3 text-xs text-warning">Adjust or remove the highlighted items to continue.</p>
          ) : null}
          <Link
            to="/shop/checkout"
            aria-disabled={unavailable.length > 0}
            className={buttonStyles('primary', 'lg', `w-full ${unavailable.length > 0 ? 'pointer-events-none opacity-50' : ''}`)}
          >
            Checkout <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-center text-[11px] text-subtle">Final prices are confirmed by the server when you place the order.</p>
        </Glass>
      </div>
    </div>
  );
}
