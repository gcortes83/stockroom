import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Sparkles, Wand2, X } from 'lucide-react';
import type { SmartFilter } from '@/shared/lib/smart-query';
import { SEARCH_SUGGESTIONS } from '@/shared/lib/smart-query';

type SmartSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  interpreted: SmartFilter[];
  remainingText: string;
  onRemoveFilter: (filter: SmartFilter) => void;
};

export function SmartSearch({ value, onChange, onSubmit, interpreted, remainingText, onRemoveFilter }: SmartSearchProps) {
  const [suggestion, setSuggestion] = useState(0);
  useEffect(() => {
    if (value) return;
    const timer = setInterval(() => setSuggestion((index) => (index + 1) % SEARCH_SUGGESTIONS.length), 3200);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <div className="space-y-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="ai-border glass-strong flex items-center gap-3 rounded-3xl px-4 py-2 shadow-[0_30px_80px_-40px_rgb(167_139_250/0.7)] sm:px-5"
      >
        <Sparkles className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <label htmlFor="smart-search" className="sr-only">
          Describe what you are looking for
        </label>
        <div className="relative min-w-0 flex-1">
          <input
            id="smart-search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={100}
            autoComplete="off"
            className="h-12 w-full bg-transparent text-base text-fg outline-none sm:text-lg"
          />
          {!value && (
            <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-base text-subtle sm:text-lg">
              <AnimatePresence mode="wait">
                <motion.span
                  key={suggestion}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="truncate"
                >
                  Try “{SEARCH_SUGGESTIONS[suggestion]}”
                </motion.span>
              </AnimatePresence>
            </div>
          )}
        </div>
        {value && (
          <button type="button" onClick={() => onChange('')} className="rounded-lg p-1.5 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
        <span className="hidden items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-subtle sm:flex">
          <CornerDownLeft className="h-3 w-3" /> Enter
        </span>
      </form>
      <AnimatePresence>
        {interpreted.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap items-center gap-2 overflow-hidden px-1"
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Wand2 className="h-3.5 w-3.5 text-accent" /> Stockroom Assist understood
            </span>
            {interpreted.map((filter) => (
              <motion.button
                layout
                key={`${filter.kind}-${filter.label}`}
                type="button"
                onClick={() => onRemoveFilter(filter)}
                className="group inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:border-accent/60"
                aria-label={`Remove ${filter.label}`}
              >
                <Sparkles className="h-3 w-3" /> {filter.label}
                <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
              </motion.button>
            ))}
            {remainingText && (
              <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                keywords: <span className="text-fg">{remainingText}</span>
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
