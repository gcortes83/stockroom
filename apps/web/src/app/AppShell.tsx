import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Boxes, Command as CommandIcon, FileUp, Moon, Receipt, ShoppingBag, Sparkles, Sun } from 'lucide-react';
import { useCommandPalette } from '@/features/command/use-command-palette';
import { cartTotals, useCart } from '@/features/cart/cart-store';
import { cn } from '@/shared/lib/cn';
import { toggleTheme, useTheme } from '@/shared/lib/theme';
import { AuroraBackground } from '@/shared/ui/aurora';
import { Kbd } from '@/shared/ui/surface';

const CommandPalette = lazy(async () => ({ default: (await import('@/features/command/CommandPalette')).CommandPalette }));

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors whitespace-nowrap',
    isActive ? 'bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]' : 'text-muted hover:text-fg',
  );

export function AppShell() {
  const { open, setOpen } = useCommandPalette();
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  useEffect(() => {
    if (open) setPaletteLoaded(true);
  }, [open]);
  const theme = useTheme();
  const { itemCount } = cartTotals(useCart());
  const location = useLocation();
  const studio = location.pathname.startsWith('/admin');

  return (
    <div className="min-h-dvh">
      <AuroraBackground />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface-2 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <NavLink to="/shop" className="flex items-center gap-2.5 pr-2" aria-label="Stockroom home">
            <span className="bg-ai grid h-8 w-8 place-items-center rounded-xl shadow-[0_6px_20px_-6px_rgb(167_139_250/0.8)]">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            <span className="hidden font-semibold tracking-tight sm:inline">Stockroom</span>
            <span className="hidden rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent sm:inline">
              AI
            </span>
          </NavLink>
          <nav className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Main">
            <NavLink to="/shop" end className={navClass}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> <span className="sr-only sm:not-sr-only">Discover</span>
            </NavLink>
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
            <NavLink to="/admin/products" className={navClass}>
              <Boxes className="h-3.5 w-3.5" aria-hidden /> <span className="sr-only sm:not-sr-only">Products</span>
            </NavLink>
            <NavLink to="/admin/imports" className={navClass}>
              <FileUp className="h-3.5 w-3.5" aria-hidden /> <span className="sr-only sm:not-sr-only">Imports</span>
            </NavLink>
            <NavLink to="/admin/orders" className={navClass}>
              <Receipt className="h-3.5 w-3.5" aria-hidden /> <span className="sr-only sm:not-sr-only">Orders</span>
            </NavLink>
          </nav>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="glass hidden h-9 items-center gap-2 rounded-xl px-3 text-xs text-muted transition-colors hover:text-fg md:flex"
          >
            <CommandIcon className="h-3.5 w-3.5" /> Ask or jump to… <Kbd>⌘K</Kbd>
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="glass grid h-9 w-9 place-items-center rounded-xl text-muted md:hidden"
            aria-label="Open command palette"
          >
            <CommandIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="glass grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:text-fg"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <NavLink
            to="/shop/cart"
            className="glass relative grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:text-fg"
            aria-label={`Cart, ${itemCount} items`}
          >
            <ShoppingBag className="h-4 w-4" />
            {itemCount > 0 && (
              <span className="bg-ai absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-semibold text-white tabular-nums">
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            )}
          </NavLink>
        </div>
        {studio && (
          <div className="border-t border-line bg-warning/8 py-1.5 text-center text-[11px] text-warning">
            Studio demo — no authentication is enforced in this challenge build.
          </div>
        )}
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 pt-8 pb-24 sm:px-6 sm:pt-12">
        <Outlet />
      </main>
      {paletteLoaded && (
        <Suspense fallback={null}>
          <CommandPalette open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </div>
  );
}
