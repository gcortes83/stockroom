import { Badge } from '@/shared/ui/surface';

export function StockBadge({ available }: { available: number }) {
  if (available <= 0) return <Badge tone="danger">Out of stock</Badge>;
  if (available <= 10) return <Badge tone="warning">Only {available} left</Badge>;
  return <Badge tone="success">In stock</Badge>;
}
