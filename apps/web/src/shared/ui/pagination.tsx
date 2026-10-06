import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '@stockroom/contracts';
import { Button } from './button';

export function Pagination({ page, onChange }: { page: PageMeta; onChange: (page: number) => void }) {
  if (page.totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-3">
      <Button variant="secondary" size="sm" disabled={page.page <= 1} onClick={() => onChange(page.page - 1)}>
        <ChevronLeft className="h-4 w-4" /> Previous
      </Button>
      <span className="text-xs text-muted tabular-nums">
        Page {page.page} of {page.totalPages} · {page.totalItems} items
      </span>
      <Button variant="secondary" size="sm" disabled={page.page >= page.totalPages} onClick={() => onChange(page.page + 1)}>
        Next <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
