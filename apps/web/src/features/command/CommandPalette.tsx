import { useState } from 'react';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  Boxes,
  FileUp,
  Moon,
  PackagePlus,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  Sun,
} from 'lucide-react';
import { api } from '@/shared/api/endpoints';
import { keys } from '@/shared/api/keys';
import { money } from '@/shared/lib/format';
import { toggleTheme, useTheme } from '@/shared/lib/theme';
import { useDebounced } from '@/shared/lib/use-debounced';
import { RawDialog } from '@/shared/ui/dialog';
import { ProductArt } from '@/shared/ui/product-art';

const itemClass =
  'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 200);
  const results = useQuery({
    queryKey: keys.productList({ q: term, pageSize: 6 }),
    queryFn: ({ signal }) => api.products({ q: term, pageSize: 6 }, signal),
    enabled: open && term.length >= 2,
  });

  const go = (path: string) => {
    onOpenChange(false);
    setSearch('');
    void navigate(path);
  };

  return (
    <RawDialog.Root open={open} onOpenChange={onOpenChange}>
      <RawDialog.Portal>
        <RawDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <RawDialog.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 focus:outline-none">
          <RawDialog.Title className="sr-only">Command palette</RawDialog.Title>
          <RawDialog.Description className="sr-only">Search products or jump anywhere</RawDialog.Description>
          <Command shouldFilter={false} className="glass-strong ai-border overflow-hidden rounded-3xl shadow-2xl">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Sparkles className="h-4 w-4 text-accent" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search products or jump to…"
                className="h-14 w-full bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
              />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matches. Try another word.</Command.Empty>
              {term.length >= 2 && (results.data?.data.length ?? 0) > 0 && (
                <Command.Group heading="Products" className="px-1 py-1 text-[11px] tracking-wide text-subtle uppercase">
                  {results.data?.data.map((product) => (
                    <Command.Item key={product.id} value={`product-${product.id}`} onSelect={() => go(`/shop/products/${product.id}`)} className={itemClass}>
                      <ProductArt seed={product.sku} categorySlug={product.category.slug} className="h-8 w-8 rounded-lg" />
                      <span className="flex-1 truncate normal-case">{product.name}</span>
                      <span className="text-xs tabular-nums normal-case">{money(product.price.amountCents)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {term.length >= 2 && (
                <Command.Item value="search-all" onSelect={() => go(`/shop?q=${encodeURIComponent(term)}`)} className={itemClass}>
                  <Search className="h-4 w-4" /> Search “{term}” in Discover
                </Command.Item>
              )}
              <Command.Group heading="Jump to" className="px-1 py-1 text-[11px] tracking-wide text-subtle uppercase">
                <Command.Item value="discover" onSelect={() => go('/shop')} className={itemClass}>
                  <Sparkles className="h-4 w-4" /> Discover products
                </Command.Item>
                <Command.Item value="cart" onSelect={() => go('/shop/cart')} className={itemClass}>
                  <ShoppingBag className="h-4 w-4" /> Cart
                </Command.Item>
                <Command.Item value="studio-products" onSelect={() => go('/admin/products')} className={itemClass}>
                  <Boxes className="h-4 w-4" /> Studio · Products
                </Command.Item>
                <Command.Item value="new-product" onSelect={() => go('/admin/products/new')} className={itemClass}>
                  <PackagePlus className="h-4 w-4" /> New product
                </Command.Item>
                <Command.Item value="imports" onSelect={() => go('/admin/imports')} className={itemClass}>
                  <FileUp className="h-4 w-4" /> Import a CSV
                </Command.Item>
                <Command.Item value="orders" onSelect={() => go('/admin/orders')} className={itemClass}>
                  <Receipt className="h-4 w-4" /> Studio · Orders
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Preferences" className="px-1 py-1 text-[11px] tracking-wide text-subtle uppercase">
                <Command.Item
                  value="theme"
                  onSelect={() => {
                    toggleTheme();
                    onOpenChange(false);
                  }}
                  className={itemClass}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} Switch to {theme === 'dark' ? 'light' : 'dark'} theme
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </RawDialog.Content>
      </RawDialog.Portal>
    </RawDialog.Root>
  );
}
