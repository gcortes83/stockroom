import { categoryIcon, productGradient } from '@/shared/lib/product-visual';
import { cn } from '@/shared/lib/cn';

type ProductArtProps = { seed: string; categorySlug: string; className?: string; iconClassName?: string; muted?: boolean };

export function ProductArt({ seed, categorySlug, className, iconClassName, muted = false }: ProductArtProps) {
  const Icon = categoryIcon(categorySlug);
  return (
    <div
      className={cn('relative isolate overflow-hidden', muted && 'grayscale', className)}
      style={{ background: productGradient(seed) }}
      aria-hidden
    >
      <div
        className="absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.25) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.25) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/10" />
      <div className="absolute inset-0 grid place-items-center">
        <Icon className={cn('h-1/3 w-1/3 text-white/90 drop-shadow-[0_6px_18px_rgb(0_0_0/0.35)]', iconClassName)} strokeWidth={1.4} />
      </div>
    </div>
  );
}
